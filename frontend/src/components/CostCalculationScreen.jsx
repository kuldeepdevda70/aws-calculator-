import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  PieChart,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Layers,
  Sparkles,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ChevronDown,
  Copy,
  Check,
  AlertTriangle,
  Play,
  Shield,
  ToggleLeft,
  ToggleRight,
  Info
} from 'lucide-react';

export default function CostCalculationScreen({
  resources = [],
  targetRegion = 'ap-south-1',
  currencySymbol = '$',
  detectedCurrency = 'USD',
  onBackToEdit,
  onProceedToPhase4
}) {
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState(null);
  const [downloadingFormat, setDownloadingFormat] = useState(null);
  const [includeInferred, setIncludeInferred] = useState(true);

  // Phase 4: Playwright Browser Automation State
  const [generatingLink, setGeneratingLink] = useState(false);
  const [shareLink, setShareLink] = useState(null);
  const [scrapedMonthlyTotal, setScrapedMonthlyTotal] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [linkStatusStep, setLinkStatusStep] = useState('');
  const [copied, setCopied] = useState(false);

  // Fetch live AWS cost calculation
  const fetchEstimate = (withInferred = true, scrapedVal = null) => {
    if (!resources || resources.length === 0) return;

    setLoading(true);
    setError(null);

    fetch('/api/v1/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resources: resources,
        hours_per_month: 730,
        currency_rate_to_usd: 1.0,
        include_inferred: withInferred,
        calculator_scraped_monthly: scrapedVal || scrapedMonthlyTotal
      })
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to compute AWS price list costs');
        return res.json();
      })
      .then(data => {
        setEstimate(data);
      })
      .catch(err => {
        console.error('Pricing error:', err);
        setError(err.message || 'Error calculating costs');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEstimate(includeInferred);
  }, [resources, includeInferred]);

  // Phase 4: Playwright Calculator Automation Handler
  const handleGenerateCalculatorLink = async () => {
    setGeneratingLink(true);
    setLinkError(null);
    setShareLink(null);
    setLinkStatusStep('Launching headless Playwright Chromium browser session...');

    const timer1 = setTimeout(() => {
      setLinkStatusStep(`Configuring AWS Region: ${targetRegion} (Mumbai)...`);
    }, 3500);

    const timer2 = setTimeout(() => {
      setLinkStatusStep('Configuring real dynamic architecture workloads on calculator.aws...');
    }, 9000);

    const timer3 = setTimeout(() => {
      setLinkStatusStep('Scraping estimate summary and extracting shareable link...');
    }, 18000);

    try {
      const response = await fetch('/api/v1/calculator/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resources: resources,
          target_region: targetRegion
        })
      });

      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);

      const data = await response.json();

      if (data.success && data.share_url) {
        setShareLink(data.share_url);
        if (data.calculator_scraped_monthly_usd) {
          setScrapedMonthlyTotal(data.calculator_scraped_monthly_usd);
          fetchEstimate(includeInferred, data.calculator_scraped_monthly_usd);
        }
      } else {
        throw new Error(data.error || data.fallback_message || 'Could not generate calculator link');
      }
    } catch (err) {
      console.error('Playwright error:', err);
      setLinkError(err.message || 'Browser automation timed out. You can still export verified Excel or PDF estimates below.');
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownload = async (format) => {
    setDownloadingFormat(format);
    try {
      const endpoint = format === 'excel' ? '/api/v1/pricing/export/excel' : '/api/v1/pricing/export/pdf';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resources: resources,
          hours_per_month: 730,
          include_inferred: includeInferred
        })
      });

      if (!response.ok) throw new Error(`Export to ${format.toUpperCase()} failed`);

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aws_migration_cost_estimate.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingFormat(null);
    }
  };

  if (loading && !estimate) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <RefreshCw size={44} className="animate-spin" style={{ color: 'var(--accent-aws)', margin: '0 auto 1.5rem' }} />
        <h3 style={{ fontSize: '1.4rem', color: '#fff', marginBottom: '0.5rem' }}>
          Querying Official AWS Price List Rates...
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Retrieving On-Demand pricing, storage rates, and inferred architecture for region <strong>{targetRegion}</strong>.
        </p>
      </div>
    );
  }

  if (error && !estimate) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
        <h3 style={{ color: '#f87171', marginBottom: '1rem' }}>Calculation Error</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error}</p>
        <button className="btn btn-secondary" onClick={onBackToEdit}>
          ← Back to Edit Screen
        </button>
      </div>
    );
  }

  const monthlyCost = estimate?.total_monthly_cost_usd || 0;
  const workloadsMonthly = estimate?.workloads_monthly_cost_usd || monthlyCost;
  const inferredMonthly = estimate?.inferred_monthly_cost_usd || 0;
  const annualCost = estimate?.total_annual_cost_usd || 0;
  const pricedItems = estimate?.priced_resources || [];
  const inferredItems = estimate?.inferred_infrastructure || [];
  const categories = estimate?.category_breakdown_usd || {};
  const completeness = estimate?.completeness_accounting;
  const reconciliation = estimate?.cost_reconciliation;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      
      {/* PLAYWRIGHT CALCULATOR HERO SECTION */}
      <div className="glass-panel" style={{
        padding: '1.75rem 2.25rem',
        background: shareLink
          ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(255, 153, 0, 0.08) 100%)'
          : 'linear-gradient(135deg, rgba(255, 153, 0, 0.1) 0%, rgba(59, 130, 246, 0.06) 100%)',
        border: shareLink ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255, 153, 0, 0.35)',
        boxShadow: shareLink ? '0 0 25px rgba(16, 185, 129, 0.2)' : '0 10px 30px rgba(0, 0, 0, 0.35)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className={`badge ${shareLink ? 'badge-success' : 'badge-aws'}`}>
              Phase 4: Playwright Automation
            </span>
            <h3 style={{ fontSize: '1.35rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={20} style={{ color: shareLink ? '#6ee7b7' : 'var(--accent-aws)' }} />
              Official AWS Pricing Calculator Link
            </h3>
          </div>

          {!generatingLink && !shareLink && (
            <button
              className="btn btn-primary"
              onClick={handleGenerateCalculatorLink}
              style={{ fontWeight: 700 }}
            >
              <Play size={16} /> Generate calculator.aws Link
            </button>
          )}
        </div>

        {!generatingLink && !shareLink && !linkError && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6 }}>
            Use headless Playwright browser automation to configure all migrated architecture workloads directly on <strong>calculator.aws</strong> in region <strong>{targetRegion}</strong> and return an official public shareable estimate URL.
          </p>
        )}

        {generatingLink && (
          <div style={{
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid rgba(255, 153, 0, 0.3)',
            textAlign: 'center'
          }}>
            <RefreshCw size={32} className="animate-spin" style={{ color: 'var(--accent-aws)', margin: '0 auto 1rem' }} />
            <div style={{ color: '#ffb74d', fontWeight: 600, fontSize: '1.05rem', marginBottom: '0.4rem' }}>
              {linkStatusStep}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Automating Chromium in headless mode. Adding workloads, configuring specs, and extracting shareable session URL.
            </p>
          </div>
        )}

        {shareLink && (
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            marginTop: '0.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6ee7b7', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.95rem' }}>
              <CheckCircle2 size={18} /> Public Estimate Created on Official AWS Pricing Calculator!
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={shareLink}
                style={{
                  flex: 1,
                  minWidth: '280px',
                  padding: '0.8rem 1rem',
                  background: '#090d16',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: '8px',
                  color: '#6ee7b7',
                  fontFamily: 'monospace',
                  fontSize: '0.92rem'
                }}
              />

              <button
                className="btn btn-secondary"
                onClick={handleCopyLink}
                style={{
                  background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                  borderColor: copied ? '#10b981' : 'var(--border-color)',
                  color: copied ? '#6ee7b7' : '#fff'
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy Link'}
              </button>

              <a
                href={shareLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={16} /> Open in AWS Calculator
              </a>
            </div>

            {scrapedMonthlyTotal && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#38bdf8' }}>
                Scraped Calculator Session Total: <strong>${scrapedMonthlyTotal.toFixed(2)}/mo</strong>
              </div>
            )}
          </div>
        )}

        {linkError && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            padding: '1.25rem',
            borderRadius: '12px',
            marginTop: '0.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <AlertTriangle size={20} style={{ color: '#f87171', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: '0.35rem', fontSize: '0.95rem' }}>
                  Automation Notice
                </div>
                <p style={{ color: '#e2e8f0', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                  {linkError}
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary pulse-glow"
                    onClick={() => handleDownload('excel')}
                    style={{ border: '1px solid rgba(16, 185, 129, 0.5)', color: '#6ee7b7' }}
                  >
                    <FileSpreadsheet size={16} /> Download Multi-Tab Excel Workbook (.xlsx)
                  </button>
                  <button
                    className="btn btn-secondary pulse-glow"
                    onClick={() => handleDownload('pdf')}
                    style={{ border: '1px solid rgba(239, 68, 68, 0.5)', color: '#fca5a5' }}
                  >
                    <FileText size={16} /> Download PDF Report
                  </button>
                  <button className="btn btn-secondary" onClick={handleGenerateCalculatorLink}>
                    <RefreshCw size={14} /> Retry Link Generation
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main KPI Card & Exports */}
      <div className="glass-panel" style={{ padding: '2rem 2.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <span className="badge badge-aws">Phase 3</span>
              <h2 style={{ fontSize: '1.7rem', color: '#fff' }}>Official AWS Migration Cost Estimate</h2>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
              Accurately calculated for region <strong>{targetRegion}</strong> with official On-Demand pricing.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleDownload('excel')}
              disabled={downloadingFormat === 'excel'}
              style={{ border: '1px solid rgba(16, 185, 129, 0.4)', color: '#6ee7b7' }}
            >
              <FileSpreadsheet size={16} /> {downloadingFormat === 'excel' ? 'Exporting...' : 'Download Excel (.xlsx)'}
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => handleDownload('pdf')}
              disabled={downloadingFormat === 'pdf'}
              style={{ border: '1px solid rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}
            >
              <FileText size={16} /> {downloadingFormat === 'pdf' ? 'Exporting...' : 'Download PDF Report'}
            </button>
          </div>
        </div>

        {/* Big KPI Numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(255, 153, 0, 0.12) 0%, rgba(255, 153, 0, 0.03) 100%)',
            border: '1px solid rgba(255, 153, 0, 0.35)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.82rem', color: '#ffb74d', fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <DollarSign size={16} /> TOTAL ESTIMATED AWS COST
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff' }}>
              ${monthlyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.4rem' }}>USD/mo</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              Direct: ${workloadsMonthly.toFixed(2)} • Inferred: ${inferredMonthly.toFixed(2)}
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(59, 130, 246, 0.03) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.82rem', color: '#93c5fd', fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <TrendingUp size={16} /> ANNUAL ESTIMATED AWS COST
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff' }}>
              ${annualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.4rem' }}>USD/yr</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              12 months baseline without upfront commitments
            </div>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-color)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
              ORIGINAL SOURCE CLOUD BILL
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#ffb74d' }}>
              {currencySymbol}{estimate?.total_source_bill_cost?.toFixed(2) || '0.00'}
              <span style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.4rem' }}>{detectedCurrency}</span>
            </div>
            {reconciliation && (
              <div style={{ fontSize: '0.75rem', color: reconciliation.delta_usd >= 0 ? '#fbbf24' : '#6ee7b7', marginTop: '0.4rem' }}>
                Variance: {reconciliation.delta_usd >= 0 ? `+${reconciliation.delta_usd.toFixed(2)}` : reconciliation.delta_usd.toFixed(2)} USD ({reconciliation.delta_percentage}%)
              </div>
            )}
          </div>
        </div>

        {/* Category Breakdown Progress Bars */}
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <h4 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Monthly Cost by Service Category
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {Object.entries(categories).map(([catName, catCost]) => {
              const pct = monthlyCost > 0 ? ((catCost / monthlyCost) * 100).toFixed(1) : 0;
              return (
                <div key={catName} style={{ background: '#0b1120', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{catName}</span>
                    <span style={{ color: '#ffb74d' }}>${catCost.toLocaleString()}</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(5, pct))}%`, height: '100%', background: 'linear-gradient(90deg, #ff9900, #38bdf8)' }} />
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.3rem', textAlign: 'right' }}>
                    {pct}% of monthly total
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* INFERRED AUXILIARY INFRASTRUCTURE SECTION */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <ShieldCheck size={20} style={{ color: '#38bdf8' }} />
              <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Inferred Auxiliary Infrastructure (Production Readiness)</h3>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Essential AWS auxiliary services automatically identified for security, networking, backup, and observability.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: includeInferred ? '#38bdf8' : 'var(--text-muted)' }}>
              Include in Total:
            </span>
            <button
              onClick={() => setIncludeInferred(!includeInferred)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: includeInferred ? '#38bdf8' : 'var(--text-muted)' }}
              title="Toggle inferred infrastructure"
            >
              {includeInferred ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {inferredItems.map(inf => (
            <div key={inf.id} style={{
              background: '#090e17',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>
                    {inf.target_aws_service} ({inf.target_aws_instance_type})
                  </span>
                  <span style={{ color: '#ffb74d', fontWeight: 700, fontSize: '0.95rem' }}>
                    ${inf.monthly_cost_usd?.toFixed(2)}/mo
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                  {inf.rationale}
                </p>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#38bdf8', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                Rate: ${inf.pricing_unit_rate}/{inf.pricing_unit_type}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RESOURCE COMPLETENESS & COST RECONCILIATION CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {/* Card 1: 100% Resource Completeness Accounting */}
        {completeness && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Layers size={18} style={{ color: '#10b981' }} />
              <h3 style={{ fontSize: '1.1rem', color: '#fff' }}>100% Resource Accounting Status</h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Every line item from the uploaded bill is fully accounted for:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: '#6ee7b7' }}>• Mapped & Validated (Exact / Spec):</span>
                <strong>{completeness.counts.MAPPED_VALIDATED} ({completeness.percentages.MAPPED_VALIDATED}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: '#fbbf24' }}>• Mapped with Assumptions (Category):</span>
                <strong>{completeness.counts.MAPPED_ASSUMPTIONS} ({completeness.percentages.MAPPED_ASSUMPTIONS}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: '#f87171' }}>• Review Required (Unmapped):</span>
                <strong>{completeness.counts.REVIEW_REQUIRED} ({completeness.percentages.REVIEW_REQUIRED}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>• Excluded (Zero usage/informational):</span>
                <strong>{completeness.counts.EXCLUDED} ({completeness.percentages.EXCLUDED}%)</strong>
              </div>
            </div>

            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden', marginTop: '1.25rem', display: 'flex' }}>
              <div style={{ width: `${completeness.percentages.MAPPED_VALIDATED}%`, background: '#10b981' }} title="Validated" />
              <div style={{ width: `${completeness.percentages.MAPPED_ASSUMPTIONS}%`, background: '#f59e0b' }} title="Assumptions" />
              <div style={{ width: `${completeness.percentages.REVIEW_REQUIRED}%`, background: '#ef4444' }} title="Review Required" />
              <div style={{ width: `${completeness.percentages.EXCLUDED}%`, background: '#64748b' }} title="Excluded" />
            </div>
          </div>
        )}

        {/* Card 2: Financial Cost Reconciliation */}
        {reconciliation && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <TrendingUp size={18} style={{ color: '#ffb74d' }} />
              <h3 style={{ fontSize: '1.1rem', color: '#fff' }}>Financial Cost Reconciliation</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Source Cloud Monthly Bill:</span>
                <strong>${reconciliation.source_monthly_bill_usd?.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>AWS Direct Workloads Cost:</span>
                <strong>${reconciliation.aws_direct_workloads_monthly_usd?.toFixed(2)}</strong>
              </div>
              {includeInferred && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>AWS Inferred Auxiliary Cost:</span>
                  <strong>+${reconciliation.aws_inferred_infrastructure_monthly_usd?.toFixed(2)}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.5rem' }}>
                <span style={{ fontWeight: 600, color: '#fff' }}>Net Migration Variance:</span>
                <strong style={{ color: reconciliation.delta_usd >= 0 ? '#fbbf24' : '#6ee7b7' }}>
                  {reconciliation.delta_usd >= 0 ? `+$${reconciliation.delta_usd.toFixed(2)}` : `-$${Math.abs(reconciliation.delta_usd).toFixed(2)}`} ({reconciliation.delta_percentage}%)
                </strong>
              </div>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '8px' }}>
              <strong>Primary Variance Drivers:</strong>
              <ul style={{ margin: '0.35rem 0 0 1rem', padding: 0 }}>
                {reconciliation.variance_drivers?.map((driver, dIdx) => (
                  <li key={dIdx} style={{ marginBottom: '0.25rem' }}>{driver}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Itemized Cost Breakdown Table */}
      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Itemized Resource Pricing Breakdown</h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>730 hours / month On-Demand Rates</span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.75rem', width: '25%' }}>Source Workload</th>
              <th style={{ padding: '0.75rem', width: '20%' }}>Target AWS Service</th>
              <th style={{ padding: '0.75rem', width: '15%' }}>Instance / Spec</th>
              <th style={{ padding: '0.75rem', width: '8%', textAlign: 'center' }}>Qty</th>
              <th style={{ padding: '0.75rem', width: '14%', textAlign: 'right' }}>Unit Rate (USD)</th>
              <th style={{ padding: '0.75rem', width: '18%', textAlign: 'right' }}>Monthly Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {pricedItems.map((item, idx) => (
              <tr key={item.id || idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <td style={{ padding: '0.85rem 0.75rem' }}>
                  <div style={{ fontWeight: 600, color: '#f8fafc' }}>{item.source_service_name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Source: {currencySymbol}{Number(item.source_cost || 0).toFixed(2)}
                  </div>
                </td>
                <td style={{ padding: '0.85rem 0.75rem', color: '#38bdf8' }}>
                  {item.target_aws_service}
                </td>
                <td style={{ padding: '0.85rem 0.75rem' }}>
                  <span style={{ background: 'rgba(255, 255, 255, 0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.82rem' }}>
                    {item.target_aws_instance_type}
                  </span>
                </td>
                <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center', color: '#e2e8f0' }}>
                  {item.target_quantity}
                </td>
                <td style={{ padding: '0.85rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                  ${Number(item.pricing_unit_rate || 0).toFixed(4)}/{item.pricing_unit_type}
                </td>
                <td style={{ padding: '0.85rem 0.75rem', textAlign: 'right', color: '#ffb74d', fontWeight: 700 }}>
                  ${Number(item.monthly_cost_usd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Navigation Bar */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.25rem 2rem',
        background: 'linear-gradient(135deg, rgba(255, 153, 0, 0.08) 0%, rgba(59, 130, 246, 0.05) 100%)',
        border: '1px solid rgba(255, 153, 0, 0.3)'
      }}>
        <button className="btn btn-secondary" onClick={onBackToEdit}>
          ← Back to Edit Screen
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {!shareLink && !generatingLink && (
            <button className="btn btn-primary" onClick={handleGenerateCalculatorLink}>
              Generate calculator.aws Link <ArrowRight size={16} />
            </button>
          )}
          {shareLink && (
            <a
              href={shareLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ textDecoration: 'none' }}
            >
              Open Official AWS Estimate <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
