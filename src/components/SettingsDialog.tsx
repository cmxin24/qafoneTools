import { useI18n, type Locale } from '@/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Settings, Moon, Sun, Monitor, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import { useUpdate } from '@/contexts/UpdateContext';
import { open } from '@tauri-apps/plugin-shell';

export function SettingsDialog() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { updateInfo, isChecking, checkError, autoCheck, setAutoCheck, checkNow } = useUpdate();

  const handleViewRelease = async () => {
    const url = updateInfo?.release_url ?? 'https://github.com/cmxin24/qafoneTools/releases';
    try {
      await open(url);
    } catch { /* ignore */ }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t.nav.settings}>
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            {t.settings.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Language */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t.settings.language}
            </h3>
            <RadioGroup
              value={locale}
              onValueChange={(val) => setLocale(val as Locale)}
              className="grid grid-cols-2 gap-3"
            >
              <div>
                <RadioGroupItem value="zh" id="lang-zh" className="peer sr-only" />
                <Label
                  htmlFor="lang-zh"
                  className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-muted bg-card p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 transition-all"
                >
                  {t.settings.chinese}
                </Label>
              </div>
              <div>
                <RadioGroupItem value="en" id="lang-en" className="peer sr-only" />
                <Label
                  htmlFor="lang-en"
                  className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-muted bg-card p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 transition-all"
                >
                  {t.settings.english}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {/* Theme */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t.settings.theme}
            </h3>
            <RadioGroup
              value={theme}
              onValueChange={(val) => setTheme(val as ThemeMode)}
              className="grid grid-cols-3 gap-3"
            >
              <div>
                <RadioGroupItem value="dark" id="theme-dark" className="peer sr-only" />
                <Label
                  htmlFor="theme-dark"
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-muted bg-card p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 transition-all text-sm"
                >
                  <Moon className="h-4 w-4 shrink-0" /> {t.settings.dark}
                </Label>
              </div>
              <div>
                <RadioGroupItem value="light" id="theme-light" className="peer sr-only" />
                <Label
                  htmlFor="theme-light"
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-muted bg-card p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 transition-all text-sm"
                >
                  <Sun className="h-4 w-4 shrink-0" /> {t.settings.light}
                </Label>
              </div>
              <div>
                <RadioGroupItem value="system" id="theme-system" className="peer sr-only" />
                <Label
                  htmlFor="theme-system"
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-muted bg-card p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 transition-all text-sm"
                >
                  <Monitor className="h-4 w-4 shrink-0" /> {t.settings.system}
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <Separator />

        {/* Updates */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.settings.updates}
          </h3>

          {/* Auto-check toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-check-toggle" className="text-sm cursor-pointer">
              {t.settings.autoCheckUpdates}
            </Label>
            <Switch
              id="auto-check-toggle"
              checked={autoCheck}
              onCheckedChange={setAutoCheck}
            />
          </div>

          {/* Current version + check button */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t.settings.currentVersion}
              {updateInfo ? ` v${updateInfo.current_version}` : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={checkNow}
              disabled={isChecking}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? t.settings.checking : t.settings.checkForUpdates}
            </Button>
          </div>

          {/* Status */}
          {!isChecking && updateInfo && !updateInfo.has_update && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t.settings.upToDate}
            </div>
          )}
          {!isChecking && updateInfo?.has_update && (
            <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-primary">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  {t.settings.updateAvailable} — {updateInfo.latest_version}
                </span>
              </div>
              <Button size="sm" onClick={handleViewRelease} className="gap-1.5 ml-2 shrink-0">
                <ExternalLink className="h-3.5 w-3.5" />
                {t.settings.viewRelease}
              </Button>
            </div>
          )}
          {!isChecking && checkError && (
            <p className="text-xs text-destructive">
              {t.settings.checkFailed}: {checkError}
            </p>
          )}
        </div>
    </DialogContent>
  </Dialog>
  );
}


