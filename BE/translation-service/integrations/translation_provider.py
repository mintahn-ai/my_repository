from deep_translator import GoogleTranslator


class TranslationProvider:
    def translate(self, text: str, lang: str) -> str:
        if lang == "vi":
            return text
        return GoogleTranslator(source="auto", target=lang).translate(text)
