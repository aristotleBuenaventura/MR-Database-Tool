import { useEffect, useState } from "react";
import { api } from "../../api/client";
import {
  applyCommissionSettingsUpdate,
  commissionProfilesMatch,
  defaultCommissionProfile,
  describeCommissionProfile,
  isCommissionWeekCode,
  latestCommissionVersion,
  sanitizeCommissionProfile,
  type CommissionProfile,
  type CommissionSettings,
  type CommissionTier,
} from "../../lib/commissionSettings";

type Props = {
  marketId: string;
  marketLabel: string;
  weeks: string[];
  settings: CommissionSettings | null;
  onSaved: (settings: CommissionSettings) => void;
};

const EMPTY_TIER: CommissionTier = { minAp: 1, percent: 50 };

export function CommissionSettingsCard({
  marketId,
  marketLabel,
  weeks,
  settings,
  onSaved,
}: Props) {
  const [profile, setProfile] = useState<CommissionProfile | null>(null);
  const [effectiveFromWeek, setEffectiveFromWeek] = useState("");
  const [exemptEarlierWeeks, setExemptEarlierWeeks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [marketId]);

  useEffect(() => {
    if (!settings) return;
    const latest = latestCommissionVersion(settings);
    setProfile(sanitizeCommissionProfile(latest.profile, marketId));
    setEffectiveFromWeek(latest.effectiveFromWeek ?? "");
    setExemptEarlierWeeks(true);
    setError(null);
  }, [marketId, settings]);

  if (!profile || !settings) {
    return (
      <section className="mr-database-section" aria-labelledby="db-calc-heading">
        <h3 id="db-calc-heading" className="mr-database-section-title">
          Commission calculation
        </h3>
        <p className="mr-database-card-desc">Loading {marketLabel} calculation…</p>
      </section>
    );
  }

  function updateTier(index: number, patch: Partial<CommissionTier>) {
    setProfile((current) => {
      if (!current) return current;
      const tiers = current.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier,
      );
      return { ...current, tiers };
    });
  }

  async function handleSave() {
    if (!profile || !settings) return;
    setError(null);
    setMessage(null);
    const week = effectiveFromWeek.trim().toUpperCase();
    if (exemptEarlierWeeks && !isCommissionWeekCode(week)) {
      setError("Choose the week the new calculation starts (YYYYWww, for example 2026W36).");
      return;
    }
    if (profile.mode === "tiered" && profile.tiers.length === 0) {
      setError("Add at least one AP tier.");
      return;
    }
    if (!exemptEarlierWeeks) {
      const confirmed = window.confirm(
        `This applies the new ${marketLabel} calculation to every week, including weeks already saved. Continue?`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const profileToSave = sanitizeCommissionProfile(profile, marketId);
      const next = applyCommissionSettingsUpdate(
        settings,
        profileToSave,
        exemptEarlierWeeks ? week : null,
        exemptEarlierWeeks,
      );
      const result = await api.saveCommissionSettings({
        marketId,
        settings: next,
      });
      onSaved(result.settings);
      setMessage(
        exemptEarlierWeeks
          ? `Saved. ${marketLabel} weeks before ${week} keep their current calculation.`
          : `Saved. ${marketLabel} uses this calculation on every week.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save calculation");
    } finally {
      setSaving(false);
    }
  }

  const defaults = defaultCommissionProfile(marketId);
  const usingDefault = commissionProfilesMatch(profile, defaults);
  const summary = describeCommissionProfile(profile);
  const cutoffNote = exemptEarlierWeeks
    ? effectiveFromWeek
      ? `Starts ${effectiveFromWeek.trim().toUpperCase()}. Earlier weeks stay as saved.`
      : "Pick the first week that should use this calculation. Earlier weeks stay as saved."
    : "Earlier weeks are not exempt. Opening them will use this calculation.";

  return (
    <section className="mr-database-section" aria-labelledby="db-calc-heading">
      <h3 id="db-calc-heading" className="mr-database-section-title">
        Commission calculation
      </h3>
      <article className="mr-database-card mr-commission-card">
        <div className="mr-database-card-head">
          <div className="mr-database-card-icon" aria-hidden>
            %
          </div>
          <h3>{marketLabel}</h3>
        </div>
        <div className="mr-commission-default">
          <div>
            <strong>Default calculation</strong>
            <p>{describeCommissionProfile(defaults)}</p>
          </div>
          <button
            type="button"
            className="mr-btn-secondary"
            onClick={() => setProfile(defaultCommissionProfile(marketId))}
            disabled={usingDefault}
          >
            {usingDefault ? "Showing default" : "Use default"}
          </button>
        </div>
        <p className="mr-database-card-desc">
          {usingDefault ? cutoffNote : `${summary} ${cutoffNote}`}
        </p>
        {message ? <p className="mr-import-message">{message}</p> : null}
        {error ? <p className="mr-import-message mr-history-error">{error}</p> : null}

        {profile.mode === "flat" ? (
          <div className="mr-commission-grid is-flat">
            <label className="mr-database-field">
              <span>Deduction %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={profile.deductionPercent}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    deductionPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="mr-database-field">
              <span>Comm %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={profile.flatPercent}
                onChange={(event) =>
                  setProfile({ ...profile, flatPercent: Number(event.target.value) })
                }
              />
            </label>
            <label className="mr-database-field">
              <span>Minimum FINAL NET</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={profile.minFinalNet}
                onChange={(event) =>
                  setProfile({ ...profile, minFinalNet: Number(event.target.value) })
                }
              />
            </label>
            <label className="mr-database-field">
              <span>AP must be greater than</span>
              <input
                type="number"
                min={0}
                step="1"
                value={profile.minAp}
                onChange={(event) =>
                  setProfile({ ...profile, minAp: Number(event.target.value) })
                }
              />
            </label>
          </div>
        ) : (
          <div className="mr-commission-tiers">
            <div className="mr-commission-grid">
              <label className="mr-database-field">
                <span>Deduction %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={profile.deductionPercent}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      deductionPercent: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="mr-database-field">
                <span>0% when FINAL NET is below</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={profile.tierMinFinalNet}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      tierMinFinalNet: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="mr-database-field">
                <span>0% when AP is below</span>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={profile.tierMinAp}
                  onChange={(event) =>
                    setProfile({ ...profile, tierMinAp: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            {profile.tiers.map((tier, index) => (
              <div className="mr-commission-tier-row" key={index}>
                <label className="mr-database-field">
                  <span>From AP</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={tier.minAp}
                    onChange={(event) =>
                      updateTier(index, { minAp: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="mr-database-field">
                  <span>Comm %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={tier.percent}
                    onChange={(event) =>
                      updateTier(index, { percent: Number(event.target.value) })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="mr-commission-remove"
                  onClick={() =>
                    setProfile({
                      ...profile,
                      tiers: profile.tiers.filter((_, tierIndex) => tierIndex !== index),
                    })
                  }
                  disabled={profile.tiers.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="mr-btn-secondary mr-commission-add"
              onClick={() =>
                setProfile({ ...profile, tiers: [...profile.tiers, { ...EMPTY_TIER }] })
              }
            >
              Add tier
            </button>
          </div>
        )}

        <p className="mr-database-card-desc">
          Deduction stays a percent of Gross Revenue, and only when Gross Revenue is
          positive. Final Commission stays System Commission + Adjustment.
        </p>
        <div className="mr-commission-footer">
          <label className="mr-database-field">
            <span>Apply from week</span>
            <input
              list="mr-commission-weeks"
              value={effectiveFromWeek}
              placeholder="2026W36"
              onChange={(event) => setEffectiveFromWeek(event.target.value.toUpperCase())}
              disabled={!exemptEarlierWeeks}
            />
            <datalist id="mr-commission-weeks">
              {weeks.map((week) => (
                <option key={week} value={week} />
              ))}
            </datalist>
          </label>
          <label className="mr-database-toggle mr-commission-exempt">
            <input
              type="checkbox"
              checked={exemptEarlierWeeks}
              onChange={(event) => setExemptEarlierWeeks(event.target.checked)}
            />
            <span>Exempt earlier weeks</span>
          </label>
          <button
            type="button"
            className="mr-btn-primary mr-commission-save"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save calculation"}
          </button>
        </div>
      </article>
    </section>
  );
}
