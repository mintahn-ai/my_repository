import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path

from business.audio_service import AudioService


class FakeRepository:
    def __init__(self):
        self.cached = None
        self.saved = []

    async def get(self, site_code, lang):
        return self.cached

    async def save(self, translation):
        self.saved.append(translation)
        self.cached = translation


class FakeTranslator:
    def __init__(self):
        self.translation_calls = 0
        self.audio_calls = 0

    async def translate_text_async(self, text, target_lang, source_lang="vi"):
        self.translation_calls += 1
        return f"{target_lang}: {text}"

    async def generate_audio(self, text, target_lang, do_translate):
        self.audio_calls += 1
        path = self.audio_path
        path.write_bytes(b"test audio")
        return str(path), False, "test-cache-key"

class AudioServiceTests(unittest.TestCase):
    def test_translation_and_audio_are_cached_for_unchanged_source(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = FakeRepository()
            translator = FakeTranslator()
            translator.audio_path = Path(directory) / "en_test-cache-key.mp3"
            service = AudioService(
                repository,
                translator,
                Path(directory),
            )

            async def generate_twice():
                return await asyncio.gather(
                    service.get_audio(
                        "test-site",
                        "A sufficiently long description for testing.",
                        "en",
                    ),
                    service.get_audio(
                        "test-site",
                        "A sufficiently long description for testing.",
                        "en",
                    ),
                )

            first, second = asyncio.run(generate_twice())

            self.assertEqual(first["description"], "en: A sufficiently long description for testing.")
            self.assertEqual(second["audio_filename"], "en_test-cache-key.mp3")
            self.assertEqual(translator.translation_calls, 1)
            self.assertEqual(translator.audio_calls, 1)
            self.assertEqual(len(repository.saved), 1)

    def test_empty_cached_audio_is_removed_and_regenerated(self):
        with tempfile.TemporaryDirectory() as directory:
            source = "A sufficiently long description for testing."
            filename = "vi_test-cache-key.mp3"
            audio_path = Path(directory) / filename
            audio_path.write_bytes(b"")
            repository = FakeRepository()
            repository.cached = {
                "source_hash": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                "audio_filename": filename,
            }
            translator = FakeTranslator()
            translator.audio_path = audio_path
            service = AudioService(repository, translator, Path(directory))

            result = asyncio.run(service.get_audio("test-site", source, "vi"))

            self.assertEqual(result["audio_filename"], filename)
            self.assertEqual(audio_path.read_bytes(), b"test audio")
            self.assertEqual(translator.audio_calls, 1)
            self.assertEqual(len(repository.saved), 1)


if __name__ == "__main__":
    unittest.main()
