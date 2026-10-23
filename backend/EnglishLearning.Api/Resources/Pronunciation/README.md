# Bundled American English pronunciations

`en_US.txt.gz` is a gzip-compressed, otherwise unmodified copy of
[open-dict-data/ipa-dict/data/en_US.txt](https://github.com/open-dict-data/ipa-dict/blob/41d62f55bd9c9275fcfd2843e8cf10c75e2696d7/data/en_US.txt).

- Source revision: `41d62f55bd9c9275fcfd2843e8cf10c75e2696d7`
- Original UTF-8 bytes: 3,180,267; lines: 125,927
- SHA-256 of uncompressed bytes: `2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67`
- Compression: Python `gzip.compress(original_bytes, mtime=0)`

The US dataset derives from [lingz/cmudict-ipa](https://github.com/lingz/cmudict-ipa)
and the [Carnegie Mellon Pronouncing Dictionary](https://github.com/cmusphinx/cmudict).
The accompanying MIT and CMU copyright/license notices are retained and copied
to build and publish output. Other languages/datasets in ipa-dict are not bundled.

The application embeds the compressed file in the backend assembly. No internet,
paid API key, Python process, or database table is needed at runtime. The dictionary
is loaded lazily once into an immutable lookup shared across requests.

These are word pronunciations, not a context-aware sentence model. The first listed
pronunciation is the default; alternatives are returned for review. Unknown words,
numbers and unsupported symbols yield `ipa: null` plus `unknownWords`; incomplete
transcription is never substituted for a complete sentence. Hyphenated compounds
can use their component words. Curly apostrophes are normalized for lookup.
