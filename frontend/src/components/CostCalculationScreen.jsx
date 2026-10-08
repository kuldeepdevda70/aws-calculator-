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
  ChevronDown
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

  // Fetch live AWS cost calculation
  useEffect(() => {
    if (!resources || resources.length === 0) return;

    setLoading(true);
    setError(null);

    fetch('/api/v1/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resources: resources,
        hours_per_month: 730,
        currency_rate_to_usd: 1.0
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
  }, [resources]);

  // Handle Excel or PDF download
  const handleDownload = async (format) => {
    setDownloadingFormat(format);
    try {
      const response = await fetch(`/api/v1/pricing/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resources: resources,
          hours_per_month: 730
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

  if (loading) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <RefreshCw size={44} className="animate-spin" style={{ color: 'var(--accent-aws)', margin: '0 auto 1.5rem' }} />
        <h3 style={{ fontSize: '1.4rem', color: '#fff', marginBottom: '0.5rem' }}>
          Querying Official AWS Price List API...
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Retrieving On-Demand hourly rates and storage tiers for region <strong>{targetRegion} (Mumbai)</strong>.
        </p>
      </div>
    );
  }

  if (error) {
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
  const annualCost = estimate?.total_annual_cost_usd || 0;
  const pricedItems = estimate?.priced_resources || [];
  const categories = estimate?.category_breakdown_usd || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Header & KPI Card */}
      <div className="glass-panel" style={{ padding: '2rem 2.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <span className="badge badge-aws">Phase 3</span>
              <h2 style={{ fontSize: '1.7rem', color: '#fff' }}>Official AWS Migration Cost Estimate</h2>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
              Computed with AWS Price List API rates for <strong>{targetRegion} (Mumbai Default)</strong>.
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

            <button className="btn btn-primary" onClick={onProceedToPhase4}>
              Generate calculator.aws Link <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Big KPI Numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(255, 153, 0, 0.12) 0%, rgba(255, 153, 0, 0.03) 100%)',
            border: '1px solid rgba(255, 153, 0, 0.35)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#ffb74d', fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <DollarSign size={16} /> ESTIMATED MONTHLY AWS COST
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff' }}>
              ${monthlyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>USD/mo</span>
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(59, 130, 246, 0.03) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#93c5fd', fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <TrendingUp size={16} /> ESTIMATED ANNUAL AWS COST
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff' }}>
              ${annualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>USD/yr</span>
            </div>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-color)',
            padding: '1.5rem',
            borderRadius: '14px'
          }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
              CALCULATED WORKLOADS
            </div>
            <div style={{ fontSize: '2.1rem', fontWeight: 800, color: '#a78bfa' }}>
              {pricedItems.length}
              <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>resources</span>
            </div>
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

      {/* Itemized Cost Breakdown Table */}
      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Itemized Resource Pricing Breakdown</h3>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>730 hours / month On-Demand</span>
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
          <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Phase 3 Cost Calculation Completed
          </span>
          <button className="btn btn-primary" onClick={onProceedToPhase4}>
            Proceed to Phase 4: calculator.aws Link <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
