param([Parameter(Mandatory=$true)][string]$AuditDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$auditPath=(Resolve-Path -LiteralPath $AuditDirectory).Path
$rows=@(Get-Content (Join-Path $auditPath 'mapping.jsonl') -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.status -in @('mapped_full','mapped_partial','rejected_phone_mapping') })
$synth=[System.Speech.Synthesis.SpeechSynthesizer]::new()
$voice=@($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' }) | Select-Object -First 1
if(!$voice){throw 'No English en-US SAPI voice is installed.'}
$synth.SelectVoice($voice.VoiceInfo.Name)
$format=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$writer=[IO.StreamWriter]::new((Join-Path $auditPath 'durations.jsonl'),$false,[Text.UTF8Encoding]::new($false))
$done=0
try {
    foreach($row in $rows){
        $result=[ordered]@{id=$row.id;voice=$voice.VoiceInfo.Name;culture='en-US';sampleRate=16000;measurement='Synthesized PCM duration; not human reading time'}
        foreach($rate in @(0,-2)){
            $memory=[IO.MemoryStream]::new()
            try{
                $synth.Rate=$rate
                $synth.SetOutputToAudioStream($memory,$format)
                $synth.Speak($row.text)
                $synth.SetOutputToNull()
                $seconds=[math]::Round($memory.Length/32000.0,4)
                $result[('secondsRate'+$rate)]=$seconds
            } finally {$synth.SetOutputToNull();$memory.Dispose()}
        }
        $writer.WriteLine(($result | ConvertTo-Json -Compress))
        $done++
        if($done % 100 -eq 0){$writer.Flush();Write-Output "Measured $done / $($rows.Count) sentences..."}
    }
} finally {$writer.Dispose();$synth.Dispose()}
Write-Output "Measured $done sentences using $($voice.VoiceInfo.Name). No synthesized audio files retained."
