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
import { Settings, Moon, Sun, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';

export function SettingsDialog() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

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
      </DialogContent>
    </Dialog>
  );
}


