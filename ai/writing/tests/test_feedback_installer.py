import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

from install_feedback_runtime import download, sha, verify_or_extract_runtime


class FeedbackInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "runtime.zip"
        self.runtime = self.root / "runtime"

    def bundle(self, members):
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, value in members.items():
                archive.writestr(name, value)

    def test_fresh_extract_and_exact_existing_payload_are_idempotent(self):
        self.bundle({"llama-server.exe": b"synthetic runtime", "ggml-cpu.dll": b"synthetic dependency"})
        verify_or_extract_runtime(self.archive, self.runtime)
        before = {p.name: sha(p) for p in self.runtime.iterdir()}
        verify_or_extract_runtime(self.archive, self.runtime)
        self.assertEqual(before, {p.name: sha(p) for p in self.runtime.iterdir()})

    def test_existing_unverified_modified_missing_or_extra_runtime_is_rejected(self):
        self.bundle({"llama-server.exe": b"expected", "ggml-cpu.dll": b"expected dependency"})
        self.runtime.mkdir()
        (self.runtime / "llama-server.exe").write_bytes(b"untrusted executable")
        with self.assertRaises(ValueError):
            verify_or_extract_runtime(self.archive, self.runtime)
        (self.runtime / "llama-server.exe").write_bytes(b"expected")
        with self.assertRaises(ValueError):
            verify_or_extract_runtime(self.archive, self.runtime)
        (self.runtime / "ggml-cpu.dll").write_bytes(b"expected dependency")
        (self.runtime / "injected.dll").write_bytes(b"extra library")
        with self.assertRaises(ValueError):
            verify_or_extract_runtime(self.archive, self.runtime)
        self.assertEqual(b"extra library", (self.runtime / "injected.dll").read_bytes())

    def test_zip_traversal_absolute_and_duplicate_windows_targets_are_rejected(self):
        for members in ({"../escape.exe": b"bad"}, {"nested/../../escape.exe": b"bad"},
                        {str(self.root / "absolute.exe"): b"bad"}, {"Server.exe": b"a", "server.exe": b"b"}):
            self.bundle(members)
            with self.assertRaises(ValueError):
                verify_or_extract_runtime(self.archive, self.runtime)
            self.assertFalse(self.runtime.exists())
            self.assertFalse((self.root / "escape.exe").exists())

    def test_download_reuses_only_matching_bytes_without_network(self):
        destination = self.root / "model.gguf"
        destination.write_bytes(b"already downloaded")
        expected = hashlib.sha256(destination.read_bytes()).hexdigest()
        with mock.patch("urllib.request.urlopen") as fetch:
            download("https://example.invalid/model", destination, expected)
            fetch.assert_not_called()
            with self.assertRaises(ValueError):
                download("https://example.invalid/model", destination, "0" * 64)
            fetch.assert_not_called()

    def test_failed_download_digest_never_publishes_payload(self):
        destination = self.root / "model.gguf"
        with mock.patch("urllib.request.urlopen", return_value=io.BytesIO(b"wrong bytes")):
            with self.assertRaises(ValueError):
                download("https://example.invalid/model", destination, "0" * 64)
        self.assertFalse(destination.exists())
        self.assertTrue(destination.with_suffix(".gguf.partial").exists())


if __name__ == "__main__":
    unittest.main()
