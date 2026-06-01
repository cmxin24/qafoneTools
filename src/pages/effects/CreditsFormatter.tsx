import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Wand2, Copy, Check } from 'lucide-react';

// ─── Default credits template ──────────────────────────────────────────────────

const DEFAULT_CREDITS = `翻译   \n\n校对   \n\n插轴   \n\n压制   `;

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Parses the credits input and builds the ASS-ready string.
 * Only lines that contain both a role and a name (separated by whitespace)
 * are included. Blank lines and role-only lines are skipped.
 * Entries are joined by \\N\\N and prefixed with the fade override tag.
 */
function generateCredits(input: string): string {
  const lines = input
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => /\S\s+\S/.test(line));

  if (lines.length === 0) return '';
  return `{\\fad(500,500)}${lines.join('\\N\\N')}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CreditsFormatterPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cf = t.creditsFormatter;
  const ep = t.effectsPage;

  const [input, setInput] = useState(DEFAULT_CREDITS);
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(() => {
    setOutput(generateCredits(input));
  }, [input]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/effects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{ep.creditsFormatterTitle}</h1>
          <p className="text-xs text-muted-foreground">{ep.creditsFormatterDesc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {/* Input */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{cf.inputLabel}</p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full resize-y rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="text-xs text-muted-foreground">{cf.inputHint}</p>
        </div>

        {/* Generate button */}
        <Button onClick={handleGenerate} className="w-full sm:w-auto self-start">
          <Wand2 className="mr-2 h-4 w-4" />
          {cf.generate}
        </Button>

        {/* Output */}
        {output && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{cf.output}</p>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="mr-2 h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="mr-2 h-3.5 w-3.5" />
                )}
                {copied ? cf.copied : cf.copy}
              </Button>
            </div>
            <pre className="w-full select-all break-all whitespace-pre-wrap rounded-xl border border-border bg-card px-4 py-3 font-mono text-xs text-foreground">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
