import asyncio
import base64
import hashlib
import tempfile
import unittest
from pathlib import Path

from business.audio_service import AudioService
from data.audio_asset_repository import AudioAssetRepository
from data.offline_narration_translations import OFFLINE_NARRATION_TRANSLATIONS


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


class FakeAudioAssetRepository:
    def __init__(self, asset):
        self.asset = asset

    async def get(self, site_code, lang):
        return self.asset


class FakeAssetCollection:
    def __init__(self, asset):
        self.asset = asset
        self.query = None

    async def find_one(self, query, projection):
        self.query = query
        return self.asset


class AudioServiceTests(unittest.TestCase):
    def test_offline_translations_generate_audio_for_matching_site_descriptions(self):
        with tempfile.TemporaryDirectory() as directory:
            translator = FakeTranslator()

            async def generate_all_languages():
                results = {}
                for lang in ("en", "ja", "zh-CN"):
                    translator.audio_path = Path(directory) / f"{lang}.mp3"
                    service = AudioService(
                        FakeRepository(),
                        translator,
                        Path(directory),
                    )
                    results[lang] = await service.get_audio(
                        "dinh-doc-lap",
                        OFFLINE_NARRATION_TRANSLATIONS["dinh-doc-lap"]["source_text"],
                        lang,
                    )
                return results

            results = asyncio.run(generate_all_languages())

            for lang in ("en", "ja", "zh-CN"):
                self.assertEqual(
                    results[lang]["description"],
                    OFFLINE_NARRATION_TRANSLATIONS["dinh-doc-lap"]["translations"][lang],
                )
            self.assertEqual(translator.translation_calls, 0)
            self.assertEqual(translator.audio_calls, 3)

    def test_offline_translation_is_not_used_for_changed_site_description(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = FakeRepository()
            translator = FakeTranslator()
            translator.audio_path = Path(directory) / "en.mp3"
            service = AudioService(repository, translator, Path(directory))

            result = asyncio.run(
                service.get_audio(
                    "dinh-doc-lap",
                    "A changed description that must be translated dynamically.",
                    "en",
                )
            )

            self.assertEqual(
                result["description"],
                "en: A changed description that must be translated dynamically.",
            )
            self.assertEqual(translator.translation_calls, 1)

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

    def test_imported_audio_assets_are_used_for_matching_translations(self):
        with tempfile.TemporaryDirectory() as directory:
            source = "A sufficiently long description for testing."
            repository = FakeRepository()
            repository.cached = {
                "source_text": source,
                "description": "A translated narration.",
                "lang": "en",
            }
            translator = FakeTranslator()
            translator.audio_path = Path(directory) / "generated.mp3"
            service = AudioService(
                repository,
                translator,
                Path(directory),
                audio_asset_repository=FakeAudioAssetRepository(
                    {"content_type": "audio/mpeg", "data": b"imported audio"}
                ),
            )

            result = asyncio.run(
                service.get_audio("test-site", source, "en")
            )

            self.assertEqual(result["description"], "A translated narration.")
            self.assertEqual(
                (Path(directory) / result["audio_filename"]).read_bytes(),
                b"imported audio",
            )
            self.assertEqual(translator.audio_calls, 0)

    def test_imported_binary_audio_asset_supports_legacy_language_code(self):
        collection = FakeAssetCollection(
            {
                "content_type": "audio/mpeg",
                "data": {
                    "$binary": {
                        "base64": base64.b64encode(b"audio bytes").decode("ascii"),
                        "subType": "00",
                    }
                },
            }
        )
        repository = AudioAssetRepository(collection)

        result = asyncio.run(repository.get("test-site", "zh-CN"))

        self.assertEqual(result["data"], b"audio bytes")
        self.assertEqual(
            collection.query["lang"]["$in"],
            ["zh-CN", "zh"],
        )

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
