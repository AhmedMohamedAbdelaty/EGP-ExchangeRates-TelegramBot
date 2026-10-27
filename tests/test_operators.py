import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "scripts" / "register_test_webhook.py"
spec = importlib.util.spec_from_file_location("register_test_webhook", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RegistrationTests(unittest.TestCase):
    def test_wrong_bot_and_unexpected_webhook_never_mutate(self):
        for results in ([{"username": "production_bot"}],
                        [{"username": module.USERNAME}, {"url": "https://other.invalid/webhook"}]):
            calls = []
            def fake_api(_token, method, _data=None):
                calls.append(method)
                return results[len(calls) - 1]
            with patch.object(module, "api", fake_api), self.assertRaises(RuntimeError):
                module.register("fake", "secret")
            self.assertNotIn("setWebhook", calls)

    def test_registration_preserves_pending_and_sets_secret(self):
        calls = []
        def fake_api(_token, method, data=None):
            calls.append((method, data))
            if method == "getMe": return {"username": module.USERNAME}
            if method == "getWebhookInfo": return {"url": "" if len(calls) == 2 else module.URL, "pending_update_count": 2}
            return True
        with patch.object(module, "api", fake_api):
            self.assertEqual(module.register("fake", "secret"), 2)
        payload = next(data for method, data in calls if method == "setWebhook")
        self.assertEqual(payload["secret_token"], "secret")
        self.assertEqual(payload["max_connections"], 1)
        self.assertNotIn("drop_pending_updates", payload)


if __name__ == "__main__":
    unittest.main()
