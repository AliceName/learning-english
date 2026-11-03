using System.ComponentModel.DataAnnotations;

namespace EnglishLearning.Api.Contracts;

public sealed record RefreshRequest([Required, StringLength(97, MinimumLength = 97)] string RefreshToken);
