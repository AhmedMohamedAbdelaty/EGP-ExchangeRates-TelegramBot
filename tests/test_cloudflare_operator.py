import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "scripts" / "cloudflare_test.py"
spec = importlib.util.spec_from_file_location("cloudflare_test", path)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class OperatorTests(unittest.TestCase):
    def test_identity_mismatch_and_unknown_webhook_never_mutate(self):
        for results in ([{"username": "another_bot"}],
                        [{"username": operator.USERNAME}, {"url": "https://other.invalid/secret"}]):
            calls = []
            def fake_api(_token, method, _data=None):
                calls.append(method)
                return results[len(calls) - 1]
            with self.subTest(results=results), patch.object(operator, "api", fake_api):
                with self.assertRaises(RuntimeError):
                    operator.register("token", "secret")
            self.assertNotIn("setWebhook", calls)

    def test_registration_accepts_only_known_targets_and_preserves_pending(self):
        for prior in ("", operator.OLD_WEBHOOK_URL, operator.WEBHOOK_URL):
            calls = []
            def fake_api(_token, method, data=None):
                calls.append((method, data))
                if method == "getMe":
                    return {"username": operator.USERNAME}
                if method == "getWebhookInfo":
                    return {"url": prior if len(calls) == 2 else operator.WEBHOOK_URL}
                return True
            with self.subTest(prior=prior), patch.object(operator, "api", fake_api), contextlib.redirect_stdout(io.StringIO()):
                operator.register("token", "secret")
            payload = next(data for method, data in calls if method == "setWebhook")
            self.assertEqual(payload, {"url": operator.WEBHOOK_URL, "secret_token": "secret", "max_connections": 1,
                                       "allowed_updates": ["message", "callback_query"]})
            self.assertNotIn("drop_pending_updates", payload)

    def test_status_redacts_unknown_webhook_and_dashboard_redacts_credentials(self):
        output = io.StringIO()
        values = {"BOT_TOKEN": "bot-secret", "WEBHOOK_SECRET": "webhook-secret", "ADMIN_SECRET": "admin-secret"}
        with patch.object(operator, "api", side_effect=[{"username": operator.USERNAME},
                          {"url": "https://other.invalid/bot-secret", "pending_update_count": 2}]), contextlib.redirect_stdout(output):
            operator.status(values["BOT_TOKEN"])
        self.assertIn("Webhook: unknown", output.getvalue())
        self.assertNotIn("bot-secret", output.getvalue())
        output = io.StringIO()
        with patch.object(operator, "request", return_value=b"<p>admin-secret bot-secret webhook-secret</p>"), contextlib.redirect_stdout(output):
            operator.dashboard(values["ADMIN_SECRET"], values)
        for secret in values.values():
            self.assertNotIn(secret, output.getvalue())

    def test_requests_do_not_follow_redirects_or_reveal_errors(self):
        self.assertIsNone(operator.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.invalid"))
        with patch.object(operator.OPENER, "open", side_effect=OSError("token-secret private-path")):
            with self.assertRaises(RuntimeError) as caught:
                operator.api("token-secret", "getMe")
        self.assertNotIn("token-secret", str(caught.exception))
        self.assertNotIn("private-path", str(caught.exception))

    def test_dashboard_sends_user_agent_and_bearer(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"<p>Dashboard</p>"
        with patch.object(operator.OPENER, "open", return_value=response) as open_request:
            with contextlib.redirect_stdout(io.StringIO()):
                operator.dashboard("admin-secret", {"ADMIN_SECRET": "admin-secret"})
        request = open_request.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer admin-secret")
        self.assertIn("egp-exchange-test-operator/1.0", request.get_header("User-agent"))

    def test_credentials_require_owner_only_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials"
            path.write_text("BOT_TOKEN=test-token\n")
            path.chmod(0o600)
            with patch.dict(os.environ, {"CLOUDFLARE_TEST_ENV": str(path)}):
                self.assertEqual(operator.read_secrets()["BOT_TOKEN"], "test-token")
                path.chmod(0o644)
                with self.assertRaises(RuntimeError):
                    operator.read_secrets()
                path.chmod(0o600)
                link = Path(directory) / "link"
                link.symlink_to(path)
                with patch.dict(os.environ, {"CLOUDFLARE_TEST_ENV": str(link)}), self.assertRaises(RuntimeError):
                    operator.read_secrets()


if __name__ == "__main__":
    unittest.main()
