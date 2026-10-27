import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

path = Path(__file__).resolve().parents[1] / "scripts/cloudflare_production.py"
spec = importlib.util.spec_from_file_location("cloudflare_production", path)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class ProductionOperatorTests(unittest.TestCase):
    def test_identity_and_unknown_target_stop_before_any_mutation(self):
        for replies in ([{"username": "randombot_test_bot"}],
                        [{"username": operator.USERNAME}, {"url": "https://unknown.invalid/token", "pending_update_count": 1}],
                        [{"username": operator.USERNAME}, {"pending_update_count": 1}]):
            calls = []
            def fake_api(_token, method, _data=None):
                calls.append(method)
                return replies[len(calls) - 1]
            with self.subTest(replies=replies), patch.object(operator, "api", fake_api), self.assertRaises(RuntimeError):
                operator.register("fake", "secret")
            self.assertNotIn("setWebhook", calls)

    def test_register_exact_target_and_queue_preservation(self):
        for prior in ("", operator.WEBHOOK_URL):
            calls = []
            def fake_api(_token, method, data=None):
                calls.append((method, data))
                if method == "getMe": return {"username": operator.USERNAME}
                if method == "getWebhookInfo":
                    return {"url": prior if len(calls) == 2 else operator.WEBHOOK_URL, "pending_update_count": 2}
                return True
            with self.subTest(prior=prior), patch.object(operator, "api", fake_api), \
                    patch.object(operator, "preflight"), contextlib.redirect_stdout(io.StringIO()):
                operator.register("fake", "secret")
            payload = next(data for method, data in calls if method == "setWebhook")
            self.assertEqual(payload, {"url": operator.WEBHOOK_URL, "secret_token": "secret", "max_connections": 1,
                                       "allowed_updates": ["message", "callback_query"]})
            self.assertNotIn("drop_pending_updates", payload)

    def test_readback_mismatch_and_failed_mutation_are_reported(self):
        for replies in ([{"username": operator.USERNAME}, {"url": "", "pending_update_count": 0}, False],
                        [{"username": operator.USERNAME}, {"url": "", "pending_update_count": 0}, True,
                         {"url": operator.WEBHOOK_URL + "?wrong=1", "pending_update_count": 0}]):
            with self.subTest(replies=replies), patch.object(operator, "api", side_effect=replies), \
                    patch.object(operator, "preflight"), self.assertRaises(RuntimeError):
                operator.register("fake", "secret")

    def test_preflight_allows_only_authenticated_invalid_json_response(self):
        def response(code, body):
            return urllib.error.HTTPError(operator.WEBHOOK_URL, code, "ignored", {}, io.BytesIO(body))
        for failure in (response(401, b"Unauthorized"), response(503, b"Service unavailable"),
                        response(302, b"Invalid request"), response(400, b"other"), OSError("secret private-path")):
            calls = []
            def fake_api(_token, method, _data=None):
                calls.append(method)
                return {"username": operator.USERNAME} if method == "getMe" else {"url": "", "pending_update_count": 1}
            with self.subTest(failure=type(failure).__name__), patch.object(operator, "api", fake_api), \
                    patch.object(operator.OPENER, "open", side_effect=failure), self.assertRaises(RuntimeError) as caught:
                operator.register("token", "secret")
            self.assertNotIn("setWebhook", calls)
            self.assertNotIn("secret", str(caught.exception))
            self.assertNotIn("private-path", str(caught.exception))
        successful_http = MagicMock()
        with patch.object(operator.OPENER, "open", return_value=successful_http), self.assertRaises(RuntimeError):
            operator.preflight("secret")
        successful_http.close.assert_called_once()
        replies = [{"username": operator.USERNAME}, {"url": "", "pending_update_count": 1}, True,
                   {"url": operator.WEBHOOK_URL, "pending_update_count": 1}]
        with patch.object(operator, "api", side_effect=replies) as api, \
                patch.object(operator.OPENER, "open", side_effect=response(400, b"Invalid request")) as opener, \
                contextlib.redirect_stdout(io.StringIO()):
            operator.register("token", "secret")
        self.assertIn("setWebhook", [call.args[1] for call in api.call_args_list])
        request = opener.call_args.args[0]
        self.assertEqual(request.full_url, operator.WEBHOOK_URL)
        self.assertEqual(request.data, b"{")
        self.assertEqual(request.get_header("X-telegram-bot-api-secret-token"), "secret")

    def test_status_hides_unknown_url_and_checks_full_target(self):
        output = io.StringIO()
        with patch.object(operator, "api", side_effect=[{"username": operator.USERNAME},
                {"url": operator.WEBHOOK_URL + "?token=private", "pending_update_count": 2}]), contextlib.redirect_stdout(output):
            operator.status("fake")
        self.assertIn("Webhook: unknown", output.getvalue())
        self.assertNotIn("private", output.getvalue())

    def test_dashboard_requires_identity_and_redacts_credentials(self):
        with patch.object(operator, "api", return_value={"username": "randombot_test_bot"}), \
                patch.object(operator, "request") as request, self.assertRaises(RuntimeError):
            operator.dashboard("bot-secret", "admin-secret", {})
        request.assert_not_called()
        output = io.StringIO()
        values = {"BOT_TOKEN": "bot-secret", "ADMIN_SECRET": "admin-secret", "WEBHOOK_SECRET": "webhook-secret"}
        with patch.object(operator, "api", return_value={"username": operator.USERNAME}), \
                patch.object(operator, "request", return_value=b"<script>hide</script><p>admin-secret bot-secret webhook-secret</p>") as request, \
                contextlib.redirect_stdout(output):
            operator.dashboard(values["BOT_TOKEN"], values["ADMIN_SECRET"], values)
        for value in values.values(): self.assertNotIn(value, output.getvalue())
        self.assertNotIn("hide", output.getvalue())
        self.assertEqual(request.call_args.args[0], operator.BASE_URL + "/admin")
        self.assertEqual(request.call_args.kwargs["headers"], {"Authorization": "Bearer admin-secret"})

    def test_dashboard_redacts_overlapping_secrets(self):
        output = io.StringIO()
        with patch.object(operator, "api", return_value={"username": operator.USERNAME}), \
                patch.object(operator, "request", return_value=b"<p>abcdef</p>"), contextlib.redirect_stdout(output):
            operator.dashboard("abc", "abcdef", {"BOT_TOKEN": "abc", "ADMIN_SECRET": "abcdef"})
        self.assertEqual(output.getvalue(), "[redacted]\n")

    def test_redirects_and_request_errors_do_not_leak(self):
        self.assertIsNone(operator.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.invalid"))
        with patch.object(operator.OPENER, "open", side_effect=OSError("secret private-path")), self.assertRaises(RuntimeError) as caught:
            operator.api("secret", "getMe")
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn("private-path", str(caught.exception))

    def test_private_credentials_reject_public_files_symlinks_and_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            path = folder / "credentials"
            path.write_text("BOT_TOKEN=123:token\n")
            path.chmod(0o600)
            with patch.object(operator, "SECRETS", path):
                self.assertEqual(operator.read_secrets()["BOT_TOKEN"], "123:token")
                path.chmod(0o644)
                with self.assertRaises(RuntimeError): operator.read_secrets()
                path.chmod(0o600)
                folder.chmod(0o755)
                with self.assertRaises(RuntimeError): operator.read_secrets()
                folder.chmod(0o700)
                link = folder / "link"
                link.symlink_to(path)
                with patch.object(operator, "SECRETS", link), self.assertRaises(RuntimeError): operator.read_secrets()
                with patch.object(operator, "SECRETS", folder), self.assertRaises(RuntimeError): operator.read_secrets()


if __name__ == "__main__":
    unittest.main()
