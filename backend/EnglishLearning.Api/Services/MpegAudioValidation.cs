namespace EnglishLearning.Api.Services;

public static class MpegAudioValidation
{
    public static double Validate(ReadOnlySpan<byte> bytes, double maxSeconds)
    {
        var offset = 0;
        if (bytes.Length >= 10 && bytes[..3].SequenceEqual("ID3"u8))
        {
            if (bytes.Slice(6, 4).ToArray().Any(value => value >= 128)) throw Invalid();
            offset = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
            if (bytes[3] == 4 && (bytes[5] & 0x10) != 0) offset += 10;
        }
        var frames = 0;
        var seconds = 0.0;
        while (offset < bytes.Length)
        {
            if (bytes.Length - offset == 128 && bytes.Slice(offset, 3).SequenceEqual("TAG"u8)) { offset += 128; break; }
            if (bytes.Length - offset < 4) throw Invalid();
            var header = bytes.Slice(offset, 4);
            var version = (header[1] >> 3) & 3;
            var layer = (header[1] >> 1) & 3;
            var bitrateIndex = header[2] >> 4;
            var sampleIndex = (header[2] >> 2) & 3;
            if (header[0] != 255 || (header[1] & 0xe0) != 0xe0 || version == 1 || layer != 1 || bitrateIndex is 0 or 15 || sampleIndex == 3) throw Invalid();
            int[] bitrates = version == 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
            int[] sampleRates = [44100, 48000, 32000];
            var sampleRate = sampleRates[sampleIndex] / (version == 3 ? 1 : version == 2 ? 2 : 4);
            var size = (version == 3 ? 144000 : 72000) * bitrates[bitrateIndex] / sampleRate + ((header[2] >> 1) & 1);
            if (size < 4 || bytes.Length - offset < size) throw Invalid();
            seconds += (version == 3 ? 1152.0 : 576.0) / sampleRate;
            if (seconds > maxSeconds) throw Invalid();
            offset += size; frames++;
        }
        if (offset != bytes.Length || frames < 2 || seconds <= 0) throw Invalid();
        return seconds;
    }

    private static VocabularyException Invalid() => new(502, "invalid_audio", "Cấu trúc hoặc thời lượng MP3 chưa hợp lệ.");
}
