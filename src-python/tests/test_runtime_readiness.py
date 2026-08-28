import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import controller as controller_module


class RuntimeReadinessTests(unittest.TestCase):
    def test_activation_launch_requires_all_manager_issued_arguments(self):
        with self.assertRaises(ValueError):
            controller_module.parseRuntimeActivationLaunchArgs([
                "VRCNT-backend.exe",
                "--runtime-activation-pipe", "vrcnt-activation-test",
                "--runtime-activation-token", "token",
            ])

    def test_runtime_readiness_reports_infrastructure_without_models_or_network(self):
        class UnexpectedModelWork:
            def __getattr__(self, name):
                raise AssertionError(f"readiness must not load a model or call a provider: {name}")

        with (
            patch.object(controller_module, "model", UnexpectedModelWork()),
            patch.object(controller_module.os, "getpid", return_value=4242),
            patch.object(controller_module.Controller, "getRuntimeVariant", return_value="cuda"),
        ):
            response = controller_module.Controller.getRuntimeReadiness(
                {"activation_token": "activation-token", "generation": 7}
            )

        self.assertEqual(response, {
            "status": 200,
            "result": {
                "protocol_version": 1,
                "status": "ready",
                "backend_pid": 4242,
                "app_version": controller_module.config.VERSION,
                "runtime_variant": "cuda",
                "activation_token": "activation-token",
                "generation": 7,
            },
        })

    def test_activation_readiness_writes_one_manager_bound_proof_only_after_a_valid_request(self):
        activation_context = controller_module.parseRuntimeActivationLaunchArgs([
            "VRCNT-backend.exe",
            "--runtime-activation-pipe", "vrcnt-activation-test",
            "--runtime-activation-token", "activation-token",
            "--runtime-activation-nonce", "manager-nonce",
            "--runtime-activation-app-version", controller_module.config.VERSION,
            "--runtime-activation-runtime-variant", "cpu",
        ])
        with (
            patch.object(controller_module.os, "getpid", return_value=4242),
            patch.object(controller_module.Controller, "getRuntimeVariant", return_value="cpu"),
            patch.object(controller_module, "writeRuntimeActivationProof") as write_proof,
        ):
            response = controller_module.Controller.getRuntimeReadiness(
                {"activation_token": "activation-token", "generation": 7}, activation_context
            )

        self.assertEqual(response["status"], 200)
        write_proof.assert_called_once_with(activation_context, {
            "protocol_version": 1,
            "status": "ready",
            "token": "activation-token",
            "nonce": "manager-nonce",
            "backend_pid": 4242,
            "app_version": controller_module.config.VERSION,
            "runtime_variant": "cpu",
        })

    def test_activation_readiness_rejects_bad_request_and_never_writes_a_proof(self):
        activation_context = controller_module.parseRuntimeActivationLaunchArgs([
            "VRCNT-backend.exe",
            "--runtime-activation-pipe", "vrcnt-activation-test",
            "--runtime-activation-token", "activation-token",
            "--runtime-activation-nonce", "manager-nonce",
            "--runtime-activation-app-version", controller_module.config.VERSION,
            "--runtime-activation-runtime-variant", "cpu",
        ])
        with patch.object(controller_module, "writeRuntimeActivationProof") as write_proof:
            response = controller_module.Controller.getRuntimeReadiness(
                {"activation_token": "wrong-token", "generation": 7}, activation_context
            )

        self.assertEqual(response["status"], 403)
        write_proof.assert_not_called()


    def test_runtime_readiness_defaults_to_cpu_when_runtime_identity_is_unavailable(self):
        with patch.object(controller_module.Controller, "getRuntimeVariant", return_value="cpu"):
            response = controller_module.Controller.getRuntimeReadiness(None)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["result"]["runtime_variant"], "cpu")
        self.assertIsNone(response["result"]["activation_token"])
        self.assertIsNone(response["result"]["generation"])
