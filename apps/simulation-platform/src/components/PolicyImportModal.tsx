import React, { useRef } from 'react';
import { ApplicablePolicyChange, InformationalPolicyFinding, ZoningPolicyAnalysis } from '../utils/zoningPolicy';
import { useLanguage } from '../i18n';
import { FileUp, RotateCcw, CheckCircle2, X, FileSearch, Info } from 'lucide-react';

interface PolicyImportModalProps {
  open: boolean;
  analysis: ZoningPolicyAnalysis | null;
  analyzing: boolean;
  error: string | null;
  policyApplied: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  onApply: () => void;
  onRevert: () => void;
}

function ChangeCard({ change }: { change: ApplicablePolicyChange }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-neutral-900">{change.label}</div>
        <div className="max-w-[55%] break-all rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-700">
          {change.legalRef}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-neutral-200 bg-white px-2 py-1.5">
          <div className="text-neutral-400">Current</div>
          <div className="font-bold text-neutral-800">{change.originalValue}</div>
        </div>
        <div className="rounded border border-emerald-200 bg-white px-2 py-1.5">
          <div className="text-neutral-400">Parsed</div>
          <div className="font-bold text-emerald-700">{change.parsedValue}</div>
        </div>
      </div>
      {change.note && <div className="mt-2 break-words text-[11px] leading-relaxed text-neutral-500">{change.note}</div>}
    </div>
  );
}

function InfoCard({ finding }: { finding: InformationalPolicyFinding }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-neutral-900">{finding.paramName}</div>
        <div className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-mono font-bold text-amber-700">
          {finding.legalRef}
        </div>
      </div>
      <div className="mt-2 text-[11px] font-bold text-amber-700">{finding.parsedValue}</div>
      {finding.note && <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{finding.note}</div>}
    </div>
  );
}

export default function PolicyImportModal({
  open,
  analysis,
  analyzing,
  error,
  policyApplied,
  onClose,
  onUpload,
  onApply,
  onRevert,
}: PolicyImportModalProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[720] bg-black/20 backdrop-blur-[1px]">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 z-[721] flex max-h-[82vh] w-[min(92vw,760px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div>
            <div className="text-base font-extrabold text-neutral-950">{t('policy.title')}</div>
            <div className="mt-1 text-[11px] text-neutral-500">{t('policy.subtitle')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition-colors hover:text-neutral-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={analyzing || policyApplied}
                className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-neutral-800"
              >
                <FileUp className="h-4 w-4" />
                {analyzing ? t('policy.analyzing') : t('policy.upload')}
              </button>
              <div className="text-[11px] leading-relaxed text-neutral-500">{t(policyApplied ? 'policy.revertBeforeUpload' : 'policy.helper')}</div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf,application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.currentTarget.value = '';
              }}
            />
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {analysis && (
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                  <div className="text-[11px] text-neutral-400">{t('policy.file')}</div>
                  <div className="mt-1 text-sm font-bold text-neutral-900">{analysis.fileName}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                  <div className="text-[11px] text-neutral-400">{t('policy.targetZone')}</div>
                  <div className="mt-1 text-sm font-bold text-neutral-900">{analysis.targetZoneClass}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                  <div className="text-[11px] text-neutral-400">{t('policy.matched')}</div>
                  <div className="mt-1 text-sm font-bold text-neutral-900">{analysis.matchedRuleCount}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
                  <div className="text-[11px] text-neutral-400">{t('policy.applicable')}</div>
                  <div className="mt-1 text-sm font-bold text-emerald-700">{analysis.applicableChanges.length}</div>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {t('policy.applicableList')}
                </div>
                <div className="flex flex-col gap-3">
                  {analysis.applicableChanges.length > 0 ? (
                    analysis.applicableChanges.map(change => <ChangeCard key={change.id} change={change} />)
                  ) : (
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                      {t('policy.noApplicable')}
                    </div>
                  )}
                </div>
              </div>

              {analysis.informationalFindings.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-900">
                    <Info className="h-4 w-4 text-amber-600" />
                    {t('policy.referenceOnly')}
                  </div>
                  <div className="flex flex-col gap-3">
                    {analysis.informationalFindings.map(finding => <InfoCard key={finding.id} finding={finding} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {!analysis && !error && !analyzing && (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-8 text-center">
              <FileSearch className="mx-auto h-6 w-6 text-neutral-400" />
              <div className="mt-3 text-sm font-bold text-neutral-900">{t('policy.emptyTitle')}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{t('policy.emptyDesc')}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-5 py-4">
          <div className="text-[11px] text-neutral-500">
            {policyApplied ? t('policy.appliedHint') : t('policy.pendingHint')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRevert}
              disabled={!policyApplied}
              className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-bold text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              {t('policy.revert')}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!analysis || analysis.applicableChanges.length === 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {t('policy.apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
