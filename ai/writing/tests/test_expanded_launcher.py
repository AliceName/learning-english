"""Exercise the Windows launcher with a fake Python executable, never a GPU/service."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CSC = Path(r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe')


@unittest.skipUnless(os.name == 'nt' and CSC.exists() and shutil.which('powershell.exe'), 'Windows PowerShell/.NET compiler required')
class ExpandedLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix='launcher fake compiler ')
        source = Path(cls.build.name) / 'FakePython.cs'
        cls.fake = Path(cls.build.name) / 'python.exe'
        source.write_text(r'''
using System;
using System.IO;
class FakePython {
  static int Main(string[] args) {
    if (Path.GetFileNameWithoutExtension(System.Reflection.Assembly.GetExecutingAssembly().Location) == "nvidia-smi") {
      File.AppendAllText(Environment.GetEnvironmentVariable("LAUNCHER_EVENTS"),"gpu-processes\n");
      string processes = Environment.GetEnvironmentVariable("LAUNCHER_GPU_PIDS");
      if (!String.IsNullOrEmpty(processes)) Console.WriteLine(processes);
      return Environment.GetEnvironmentVariable("LAUNCHER_GPU_QUERY_FAIL") == "1" ? 3 : 0;
    }
    if (Environment.GetEnvironmentVariable("LAUNCHER_STDERR_INFO") == "1")
      Console.Error.WriteLine("INFO: ordinary Python progress on stderr");
    string events = Environment.GetEnvironmentVariable("LAUNCHER_EVENTS");
    if (args.Length > 0 && args[0] == "-c") {
      File.AppendAllText(events,"memory\n");
      Console.WriteLine("Free CUDA VRAM: 4096 MiB");
      return Environment.GetEnvironmentVariable("LAUNCHER_MEMORY_FAIL") == "1" ? 1 : 0;
    }
    if (args.Length > 0 && Path.GetFileName(args[0]) == "data.py") {
      File.AppendAllText(events,"data\n");
      File.WriteAllLines(Environment.GetEnvironmentVariable("LAUNCHER_LEGACY_CAPTURE"),args);
      if (Environment.GetEnvironmentVariable("LAUNCHER_DATA_FAIL") == "1") return 4;
      int output = Array.IndexOf(args,"--output") + 1;
      Directory.CreateDirectory(args[output]);
      File.WriteAllText(Path.Combine(args[output],"preparation-report.json"),
        "{\"gec\":{\"train\":{\"count\":1},\"dev\":{\"count\":1},\"test\":{\"count\":1}},\"cefr\":{\"train\":{\"count\":1},\"dev\":{\"count\":1},\"test\":{\"count\":1}}}");
      return 0;
    }
    if (args.Length > 0 && Path.GetFileName(args[0]) == "prepare_verified_corpus.py") {
      File.AppendAllText(events,"verified-data\n");
      File.WriteAllLines(Environment.GetEnvironmentVariable("LAUNCHER_PREP_CAPTURE"),args);
      if (Environment.GetEnvironmentVariable("LAUNCHER_VERIFIED_PREP_FAIL") == "1") return 5;
      int output = Array.IndexOf(args,"--output") + 1;
      Directory.CreateDirectory(args[output]);
      File.WriteAllText(Path.Combine(args[output],"preparation-report.json"),
        "{\"gec\":{\"train\":{\"count\":1},\"dev\":{\"count\":1},\"test\":{\"count\":1}}}");
      return 0;
    }
    File.AppendAllText(events,"train\n");
    File.WriteAllLines(Environment.GetEnvironmentVariable("LAUNCHER_CAPTURE"),args);
    return Environment.GetEnvironmentVariable("LAUNCHER_TRAIN_FAIL") == "1" ? 7 : 0;
  }
}
''', encoding='utf-8')
        result = subprocess.run([str(CSC), '/nologo', '/target:exe', '/out:' + str(cls.fake), str(source)],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='Writing launcher workspace ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(ROOT / 'Train-Expanded.ps1', self.root / 'Train-Expanded.ps1')
        shutil.copyfile(ROOT / 'Train-VerifiedCorpus.ps1', self.root / 'Train-VerifiedCorpus.ps1')
        executable = self.root / '.venv/Scripts/python.exe'
        executable.parent.mkdir(parents=True)
        shutil.copyfile(self.fake, executable)
        shutil.copyfile(self.fake, executable.with_name('nvidia-smi.exe'))
        self.capture = self.root / 'captured.txt'
        self.events = self.root / 'events.txt'
        self.prep_capture = self.root / 'prepared-arguments.txt'
        self.legacy_capture = self.root / 'legacy-arguments.txt'

    def run_launcher(self, *arguments, env_extra=None, mock_service=False, culture=None, hold_gpu_lock=False,
                     entrypoint='Train-Expanded.ps1'):
        environment = dict(os.environ, LAUNCHER_CAPTURE=str(self.capture), LAUNCHER_EVENTS=str(self.events),
                           LAUNCHER_PREP_CAPTURE=str(self.prep_capture), LAUNCHER_LEGACY_CAPTURE=str(self.legacy_capture))
        environment['PATH'] = str(self.root / '.venv/Scripts') + os.pathsep + environment.get('PATH', '')
        environment.update(env_extra or {})
        if mock_service:
            for name in ('old-cefr', 'old-gec'):
                folder = self.root / 'artifacts' / name
                folder.mkdir(parents=True, exist_ok=True)
                (folder / 'run.json').write_text('{}')
            wrapper = self.root / 'invoke_service_mocks.ps1'
            restore_capture = self.root / 'restored-arguments.json'
            environment['LAUNCHER_RESTORE_CAPTURE'] = str(restore_capture)
            # This wrapper replaces service cmdlets in this disposable process only.
            # No real listener or service process can be inspected/stopped/started.
            code = r'''
$global:launcherListening = $true
function Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction) if ($global:launcherListening) { [pscustomobject]@{OwningProcess=73} } }
function Get-CimInstance { param($ClassName,$Filter) [pscustomobject]@{CommandLine=('python -m uvicorn serve:app --app-dir ' + $PSScriptRoot)} }
function Invoke-RestMethod { param($Uri,$TimeoutSec) [pscustomobject]@{status='ready';cefrRun='old-cefr';gecRun='old-gec';correctionsEnabled=$true} }
function Stop-Process { param($Id) $global:launcherListening=$false; [IO.File]::AppendAllText($env:LAUNCHER_EVENTS,"stop\n") }
function Wait-Process { param($Id,$Timeout,$ErrorAction) }
function Start-Process {
    param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
    if ($WindowStyle -ne 'Hidden') { throw 'Service restart must remain hidden.' }
    $ArgumentList | ConvertTo-Json | Set-Content -LiteralPath $env:LAUNCHER_RESTORE_CAPTURE -Encoding UTF8
    [IO.File]::AppendAllText($env:LAUNCHER_EVENTS,"restore\n")
    $global:launcherListening=$true
    [pscustomobject]@{Id=74}
}
'''
            words = [arg if arg.startswith('-') else "'" + arg.replace("'", "''") + "'" for arg in arguments]
            code += "\n& (Join-Path $PSScriptRoot '" + entrypoint + "') " + ' '.join(words) + '\n'
            wrapper.write_text(code, encoding='utf-8')
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(wrapper)]
        elif culture or hold_gpu_lock:
            wrapper = self.root / 'invoke_culture.ps1'
            words = [arg if arg.startswith('-') else "'" + arg.replace("'", "''") + "'" for arg in arguments]
            code = "[Threading.Thread]::CurrentThread.CurrentCulture = '" + culture + "'\n" if culture else ''
            invocation = "& (Join-Path $PSScriptRoot '" + entrypoint + "') " + ' '.join(words) + '\n'
            if hold_gpu_lock:
                code += "$lockDirectory = Join-Path $PSScriptRoot '.cache/locks'\n"
                code += "$null = New-Item -ItemType Directory -Path $lockDirectory -Force\n"
                code += "$heldGpuLock = [IO.File]::Open((Join-Path $lockDirectory 'writing-gpu.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)\n"
                code += 'try {\n' + invocation + '} finally { $heldGpuLock.Dispose() }\n'
            else:
                code += invocation
            wrapper.write_text(code, encoding='utf-8')
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(wrapper)]
        else:
            command = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                       str(self.root / entrypoint), *arguments]
        return subprocess.run(command,
                              capture_output=True, text=True, encoding='utf-8', errors='replace', env=environment,
                              timeout=30)

    def captured(self):
        return self.capture.read_text(encoding='utf-8-sig').splitlines()

    def test_qvo_new_run_preserves_explicit_parent_and_batch(self):
        parent = str(self.root / 'artifacts/parent with spaces')
        result = self.run_launcher('-RunName', 'qvo-new', '-GecLoraProfile', 'qvo', '-InitRun', parent,
                                   '-BatchSize', '8', '-Epochs', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(args[args.index('--gec-lora-profile') + 1], 'qvo')
        self.assertEqual(args[args.index('--init-run') + 1], parent)
        self.assertEqual(args[args.index('--batch-size') + 1], '8')
        self.assertEqual(args[args.index('--epochs') + 1], '2')

    def test_legacy_default_still_explicit_qv(self):
        result = self.run_launcher('-RunName', 'legacy-new')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(args[args.index('--gec-lora-profile') + 1], 'qv')
        self.assertNotIn('--preparation-report', args)
        self.assertNotIn('verified-data', self.events.read_text().splitlines())

    def test_verified_profile_bootstraps_legacy_then_checks_new_data_and_passes_report(self):
        source = str(self.root / 'corpus source with spaces')
        result = self.run_launcher('-DataProfile', 'verified-unicode-train', '-Source', source,
                                   '-RunName', 'verified-new', '-BatchSize', '8')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        folder = self.root / 'data/prepared-verified-unicode-train-v2'
        self.assertEqual(Path(args[args.index('--train-file') + 1]), folder / 'gec-train.jsonl')
        self.assertEqual(Path(args[args.index('--dev-file') + 1]), folder / 'gec-dev.jsonl')
        self.assertEqual(Path(args[args.index('--preparation-report') + 1]), folder / 'preparation-report.json')
        prepared = self.prep_capture.read_text(encoding='utf-8-sig').splitlines()
        self.assertEqual(prepared[prepared.index('--source') + 1], source)
        self.assertEqual(Path(prepared[prepared.index('--prepared') + 1]), self.root / 'data/prepared-first-final')
        self.assertEqual(Path(prepared[prepared.index('--output') + 1]), folder)
        self.assertIn('--reuse', prepared)
        legacy = self.legacy_capture.read_text(encoding='utf-8-sig').splitlines()
        self.assertEqual(Path(legacy[legacy.index('--output') + 1]), self.root / 'data/prepared-first-final')
        self.assertEqual(self.events.read_text().splitlines(), ['data', 'verified-data', 'gpu-processes', 'memory', 'train'])

    def test_verified_profile_cefr_rejected_before_logs_or_native_calls(self):
        result = self.run_launcher('-ModelTask', 'cefr', '-DataProfile', 'verified-unicode-train')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('verified-unicode-train applies only to gec', result.stderr)
        self.assertFalse(self.events.exists())
        self.assertFalse((self.root / '.cache/training-launcher-logs').exists())

    def test_verified_preparation_fails_before_gpu_or_training(self):
        for key, events in (('LAUNCHER_DATA_FAIL', ['data']),
                            ('LAUNCHER_VERIFIED_PREP_FAIL', ['data', 'verified-data'])):
            with self.subTest(stage=key):
                if self.events.exists():
                    self.events.unlink()
                result = self.run_launcher('-DataProfile', 'verified-unicode-train', env_extra={key:'1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.capture.exists())
                self.assertEqual(self.events.read_text().splitlines(), events)

    def test_verified_wrapper_defaults_keep_parent_optimizer_new_and_paths_intact(self):
        source = str(self.root / 'corpus source with spaces')
        result = self.run_launcher('-Source', source, '-NoTokenCache', entrypoint='Train-VerifiedCorpus.ps1')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        for flag, value in (('--epochs', '2'), ('--batch-size', '8'), ('--gradient-accumulation', '1'),
                            ('--gec-lora-profile', 'qvo'), ('--gec-eval-seed', '2026')):
            self.assertEqual(args[args.index(flag) + 1], value)
        self.assertEqual(float(args[args.index('--learning-rate') + 1]), .0002)
        self.assertEqual(Path(args[args.index('--init-run') + 1]), self.root / 'artifacts/gec-expanded-v1')
        self.assertEqual(Path(args[args.index('--output') + 1]), self.root / 'artifacts/gec-unicode-verified-v1')
        self.assertIn('--require-bf16', args)
        self.assertIn('--no-token-cache', args)
        self.assertNotIn('--resume-checkpoint', args)
        prepared = self.prep_capture.read_text(encoding='utf-8-sig').splitlines()
        self.assertEqual(prepared[prepared.index('--source') + 1], source)

    def test_verified_wrapper_prepare_only_never_checks_gpu_or_starts_train(self):
        result = self.run_launcher('-PrepareOnly', entrypoint='Train-VerifiedCorpus.ps1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.capture.exists())
        self.assertEqual(self.events.read_text().splitlines(), ['data', 'verified-data'])

    def test_verified_wrapper_forwards_custom_parent_and_service_restore_switches(self):
        parent = str(self.root / "artifacts/parent owner's model")
        result = self.run_launcher('-InitRun', parent, '-StopLocalAi', '-RestoreLocalAi',
                                   entrypoint='Train-VerifiedCorpus.ps1', mock_service=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(args[args.index('--init-run') + 1], parent)
        self.assertEqual(self.events.read_text().replace('\\n', '\n').splitlines(),
                         ['data', 'verified-data', 'stop', 'gpu-processes', 'memory', 'train', 'restore'])
        self.assertIn('Restored the original Writing AI models', result.stdout)

    def test_verified_wrapper_propagates_training_failure_after_restoring_service(self):
        result = self.run_launcher('-StopLocalAi', '-RestoreLocalAi', entrypoint='Train-VerifiedCorpus.ps1',
                                   mock_service=True, env_extra={'LAUNCHER_TRAIN_FAIL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Training stopped with exit code 7', result.stderr)
        self.assertIn('Restored the original Writing AI models', result.stdout)
        self.assertEqual(self.events.read_text().replace('\\n', '\n').splitlines(),
                         ['data', 'verified-data', 'stop', 'gpu-processes', 'memory', 'train', 'restore'])

    def test_verified_wrapper_resume_omits_default_parent_and_rejects_explicit_parent(self):
        output = self.root / 'artifacts/gec-unicode-verified-v1/checkpoint-250'
        output.mkdir(parents=True)
        for name in ('trainer_state.json', 'optimizer.pt', 'scheduler.pt', 'rng_state.pth',
                     'adapter_model.safetensors', 'tokenizer_config.json'):
            (output / name).write_text('{}')
        result = self.run_launcher('-Resume', entrypoint='Train-VerifiedCorpus.ps1')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(Path(args[args.index('--resume-checkpoint') + 1]), output)
        self.assertNotIn('--init-run', args)
        self.events.unlink()
        rejected = self.run_launcher('-Resume', '-InitRun', str(self.root / 'explicit parent'), entrypoint='Train-VerifiedCorpus.ps1')
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('Choose Resume or an explicit InitRun', rejected.stderr)
        self.assertFalse(self.events.exists())

    def test_learning_rate_is_invariant_under_comma_decimal_locale(self):
        result = self.run_launcher('-RunName', 'lr-locale', '-LearningRate', '0.00005', '-Experiment',
                                   '-RequireBf16', culture='fr-FR')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(float(args[args.index('--learning-rate') + 1]), .00005)
        self.assertNotIn(',', args[args.index('--learning-rate') + 1])
        self.assertIn('--experiment', args)
        self.assertIn('--require-bf16', args)
        self.assertEqual(args[args.index('--early-stopping-patience') + 1], '0')

    def test_learning_rate_rejects_nonpositive_and_nonfinite_before_native_work(self):
        for value in ('0', '-1', 'NaN', 'Infinity'):
            with self.subTest(value=value):
                result = self.run_launcher('-LearningRate', value)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.events.exists())

    def test_stderr_info_succeeds_only_when_native_exit_is_zero_and_is_logged(self):
        result = self.run_launcher('-RunName', 'stderr-zero', env_extra={'LAUNCHER_STDERR_INFO': '1'})
        self.assertEqual(result.returncode, 0, result.stderr)
        logs = list((self.root / '.cache/training-launcher-logs').glob('*.log'))
        self.assertEqual(len(logs), 1)
        log = logs[0].read_text(encoding='utf-8-sig')
        self.assertIn('INFO: ordinary Python progress on stderr', log)
        self.assertEqual(log.count(' EXIT 0'), 4)
        self.assertIn('--learning-rate', log)
        failed = self.run_launcher('-RunName', 'stderr-fail',
            env_extra={'LAUNCHER_STDERR_INFO': '1', 'LAUNCHER_TRAIN_FAIL': '1'})
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('exit code 7', failed.stderr)

    def test_resume_selects_latest_complete_and_forwards_qvo(self):
        output = self.root / 'artifacts/qvo-new'
        for step in (250, 251):
            checkpoint = output / ('checkpoint-' + str(step))
            checkpoint.mkdir(parents=True)
            for name in ('trainer_state.json', 'optimizer.pt', 'scheduler.pt', 'rng_state.pth',
                         'adapter_model.safetensors', 'tokenizer_config.json'):
                if step != 251 or name != 'optimizer.pt':
                    (checkpoint / name).write_text('{}')
        result = self.run_launcher('-RunName', 'qvo-new', '-Resume', '-GecLoraProfile', 'qvo', '-Epochs', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.captured()
        self.assertEqual(Path(args[args.index('--resume-checkpoint') + 1]).name, 'checkpoint-250')
        self.assertEqual(args[args.index('--gec-lora-profile') + 1], 'qvo')
        self.assertNotIn('--init-run', args)

    def test_cefr_rejects_qvo_before_data_or_gpu_checks(self):
        result = self.run_launcher('-ModelTask', 'cefr', '-GecLoraProfile', 'qvo')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('GecLoraProfile applies only to gec', result.stderr)
        self.assertFalse(self.events.exists())

    def test_cefr_does_not_receive_gec_profile(self):
        result = self.run_launcher('-ModelTask', 'cefr', '-RunName', 'cefr-new')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--gec-lora-profile', self.captured())

    def test_restore_requires_stop_before_any_native_work(self):
        result = self.run_launcher('-RestoreLocalAi')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('RestoreLocalAi requires StopLocalAi', result.stderr)
        self.assertFalse(self.events.exists())

    def test_insufficient_memory_stops_without_train_or_batch_retry(self):
        result = self.run_launcher('-RunName', 'memory-new', '-BatchSize', '8',
                                   env_extra={'LAUNCHER_MEMORY_FAIL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.capture.exists())
        self.assertEqual(self.events.read_text().splitlines(), ['data', 'gpu-processes', 'memory'])

    def test_active_gpu_compute_process_is_rejected_before_cuda_probe(self):
        result = self.run_launcher('-RunName', 'occupied-gpu',
                                   env_extra={'LAUNCHER_GPU_PIDS': '991\n992'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('GPU compute processes are active', result.stderr)
        self.assertFalse(self.capture.exists())
        self.assertEqual(self.events.read_text().splitlines(), ['data', 'gpu-processes'])

    def test_failed_gpu_process_query_is_not_assumed_idle(self):
        result = self.run_launcher('-RunName', 'gpu-query-failed',
                                   env_extra={'LAUNCHER_GPU_QUERY_FAIL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Cannot verify GPU process exclusivity', result.stderr)
        self.assertFalse(self.capture.exists())
        self.assertEqual(self.events.read_text().splitlines(), ['data', 'gpu-processes'])

    def test_gpu_lock_refuses_a_second_launcher_before_inspecting_or_stopping_processes(self):
        result = self.run_launcher('-RunName', 'gpu-lock-held', hold_gpu_lock=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Another Writing GPU operation is active', result.stderr)
        self.assertFalse(self.capture.exists())
        self.assertEqual(self.events.read_text().splitlines(), ['data'])
        second = self.run_launcher('-RunName', 'gpu-lock-held')
        self.assertEqual(second.returncode, 0, second.stderr)

    def test_training_failure_propagates_and_releases_lock(self):
        result = self.run_launcher('-RunName', 'failure-new', env_extra={'LAUNCHER_TRAIN_FAIL': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Training stopped', result.stderr)
        # Releasing the handle allows the next launcher invocation to acquire this run's lock.
        second = self.run_launcher('-RunName', 'failure-new')
        self.assertEqual(second.returncode, 0, second.stderr)

    def test_old_service_restored_in_hidden_process_after_training_failure(self):
        result = self.run_launcher('-RunName', 'failure-restore', '-StopLocalAi', '-RestoreLocalAi',
                                   env_extra={'LAUNCHER_TRAIN_FAIL': '1'}, mock_service=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Training stopped', result.stderr)
        self.assertIn('Restored the original Writing AI models', result.stdout)
        events = self.events.read_text().replace('\\n', '\n').splitlines()
        self.assertEqual(events, ['data', 'stop', 'gpu-processes', 'memory', 'train', 'restore'])
        arguments = json.loads((self.root / 'restored-arguments.json').read_text(encoding='utf-8-sig'))
        self.assertIn('"' + str(self.root / 'Start-Writing.ps1') + '"', arguments)
        self.assertIn('"' + str(self.root / 'artifacts/old-gec') + '"', arguments)
        self.assertNotIn('"' + str(self.root / 'artifacts/failure-restore') + '"', arguments)


if __name__ == '__main__':
    unittest.main()
