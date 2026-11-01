namespace EnglishLearning.Api.Services.CloudinaryMedia;

public static class CloudMediaValidation
{
    public static string ValidateBytes(CloudMediaKind kind, string format, ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 12 || bytes.Length > (kind == CloudMediaKind.CourseAudio ? 25 : 5) * 1024 * 1024)
            throw new CloudMediaException(400, "invalid_media_size");
        var type = kind == CloudMediaKind.CourseCover ? format switch
        {
            "jpg" or "jpeg" when bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff => "image/jpeg",
            "png" when bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) => "image/png",
            "webp" when bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8) => "image/webp",
            _ => null
        } : format switch
        {
            "ogg" or "mp3" or "wav" when DictionaryAudioDownload.Detect(bytes) is { } detected && detected.Extension == format => detected.Type,
            "aac" when bytes[0] == 0xff && (bytes[1] & 0xf6) == 0xf0 => "audio/aac",
            "m4a" when bytes.Slice(4, 4).SequenceEqual("ftyp"u8) => "audio/mp4",
            _ => null
        };
        return type ?? throw new CloudMediaException(400, "invalid_media_format");
    }

    public static bool MatchesMime(string expected, string? actual) => expected == actual || expected switch
    {
        "audio/ogg" => actual is "application/ogg" or "audio/vorbis" or "audio/opus",
        "audio/wav" => actual is "audio/x-wav" or "audio/wave" or "audio/vnd.wave",
        "audio/mp4" => actual is "audio/x-m4a" or "video/mp4",
        _ => false
    };
}
