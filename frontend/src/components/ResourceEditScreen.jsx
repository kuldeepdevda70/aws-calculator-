import React, { useState, useEffect } from 'react';
import {
  Server,
  Database,
  HardDrive,
  Globe,
  Trash2,
  Plus,
  Save,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  Cpu,
  Layers,
  Sparkles,
  ExternalLink,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';

export default function ResourceEditScreen({
  initialResources = [],
  detectedProvider = 'Unknown Cloud',
  currencySymbol = '$',
  detectedCurrency = 'USD',
  initialRegion = 'ap-south-1',
  onProceedToCost,
  onBackToUpload
}) {
  const [resources, setResources] = useState(initialResources);
  const [targetRegion, setTargetRegion] = useState(initialRegion);
  const [options, setOptions] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [saveStatus, setSaveStatus] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch available AWS options for dropdowns
  useEffect(() => {
    fetch('/api/v1/mapping/options')
      .then(res => res.json())
      .then(data => {
        setOptions(data);
        if (data.default_region && !initialRegion) {
          setTargetRegion(data.default_region);
        }
      })
      .catch(err => console.error('Error fetching mapping options:', err));
  }, []);

  // Sync initial resources if changed
  useEffect(() => {
    if (initialResources && initialResources.length > 0) {
      setResources(initialResources);
    }
  }, [initialResources]);

  // Handle single field change
  const handleResourceChange = (id, field, value) => {
    setResources(prev =>
      prev.map(r => {
        if (r.id === id) {
          const updated = { ...r, [field]: value };
          if (field === 'target_aws_service' && options?.available_services) {
            const foundService = options.available_services.find(s => s.name === value);
            if (foundService) {
              updated.target_aws_service_code = foundService.code;
              updated.target_aws_category = foundService.category;
              updated.is_review_required = false;
              if (updated.mapping_confidence === 'review_required') {
                updated.mapping_confidence = 'manual_mapped';
              }
              if (foundService.common_instances?.length) {
                updated.target_aws_instance_type = foundService.common_instances[0];
              }
            }
          }
          return updated;
        }
        return r;
      })
    );
  };

  // Delete resource
  const handleDelete = (id) => {
    setResources(prev => prev.filter(r => r.id !== id));
  };

  // Add custom resource
  const handleAddResource = () => {
    const newId = `custom-${Date.now()}`;
    const newResource = {
      id: newId,
      source_provider: detectedProvider,
      source_service_name: 'Custom Cloud Workload',
      source_sku: 'custom.vm',
      source_cost: 0.0,
      source_usage_amount: 1,
      source_usage_unit: 'Units',
      target_aws_service: 'Amazon EC2',
      target_aws_service_code: 'AmazonEC2',
      target_aws_category: 'Compute',
      target_aws_instance_type: 't3.medium',
      target_aws_region: targetRegion,
      target_vcpu: 2,
      target_ram_gb: 4.0,
      target_storage_gb: 0,
      target_quantity: 1,
      mapping_confidence: 'manual_mapped',
      mapping_rationale: 'Manually added workload',
      notes: 'Manually added workload'
    };
    setResources([newResource, ...resources]);
  };

  // Bulk update region
  const handleGlobalRegionChange = (newRegion) => {
    setTargetRegion(newRegion);
    setResources(prev => prev.map(r => ({ ...r, target_aws_region: newRegion })));
  };

  // Save changes to backend
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/v1/mapping/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resources: resources,
          target_region: targetRegion
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSaveStatus('Changes saved successfully!');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      console.error('Error saving mappings:', err);
      setSaveStatus(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered resources
  const filtered = resources.filter(r => {
    const matchesSearch =
      r.source_service_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.target_aws_service?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.target_aws_instance_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.source_sku?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      categoryFilter === 'ALL' ||
      (categoryFilter === 'REVIEW' && (r.is_review_required || r.mapping_confidence === 'review_required')) ||
      r.target_aws_category?.toUpperCase() === categoryFilter.toUpperCase() ||
      r.target_aws_service?.toUpperCase().includes(categoryFilter);

    return matchesSearch && matchesCategory;
  });

  // Calculate summary metrics
  const totalSourceCost = resources.reduce((sum, r) => sum + (Number(r.source_cost) || 0), 0);
  const totalQuantity = resources.reduce((sum, r) => sum + (Number(r.target_quantity) || 1), 0);
  const reviewRequiredCount = resources.filter(r => r.is_review_required || r.mapping_confidence === 'review_required').length;
  const exactSkuCount = resources.filter(r => r.mapping_confidence === 'exact_sku' || r.mapping_confidence === 'spec_matched').length;

  // Render confidence badge
  const renderConfidenceBadge = (confidence, isReview) => {
    if (isReview || confidence === 'review_required') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(239, 68, 68, 0.15)',
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          padding: '2px 8px',
          borderRadius: '9999px',
          fontSize: '0.72rem',
          fontWeight: 600
        }}>
          <AlertTriangle size={11} /> Review Required
        </span>
      );
    }
    if (confidence === 'exact_sku') {
      return (
        <span style={{
          background: 'rgba(16, 185, 129, 0.15)',
          color: '#6ee7b7',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          padding: '2px 8px',
          borderRadius: '9999px',
          fontSize: '0.72rem',
          fontWeight: 600
        }}>
          Exact SKU
        </span>
      );
    }
    if (confidence === 'spec_matched') {
      return (
        <span style={{
          background: 'rgba(56, 189, 248, 0.15)',
          color: '#38bdf8',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          padding: '2px 8px',
          borderRadius: '9999px',
          fontSize: '0.72rem',
          fontWeight: 600
        }}>
          Spec Matched
        </span>
      );
    }
    return (
      <span style={{
        background: 'rgba(245, 158, 11, 0.15)',
        color: '#fbbf24',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.72rem',
        fontWeight: 600
      }}>
        Category Rule
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Top Banner & KPI Header */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <span className="badge badge-aws" style={{ fontSize: '0.85rem' }}>Phase 2</span>
              <h2 style={{ fontSize: '1.6rem', color: '#fff' }}>Review & Edit AWS Architecture Mapping</h2>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
              Verify converted workloads from <strong>{detectedProvider}</strong> into equivalent AWS services. Review confidence ratings, instance specs, and storage volumes.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleAddResource}>
              <Plus size={16} /> Add Workload
            </button>
            <button className="btn btn-secondary" onClick={handleSave} disabled={isSaving}>
              <Save size={16} /> {isSaving ? 'Saving...' : 'Save Mappings'}
            </button>
            <button className="btn btn-primary" onClick={() => onProceedToCost && onProceedToCost(resources, targetRegion)}>
              Proceed to Cost Estimator <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {reviewRequiredCount > 0 && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#fca5a5', fontSize: '0.92rem' }}>
              <AlertTriangle size={18} style={{ color: '#f87171' }} />
              <span><strong>{reviewRequiredCount} workload(s)</strong> require manual architect review. They have been tagged below with suggested AWS candidates.</span>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setCategoryFilter('REVIEW')}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', borderColor: '#f87171', color: '#fca5a5' }}
            >
              Filter Review Items
            </button>
          </div>
        )}

        {saveStatus && (
          <div style={{
            background: saveStatus.includes('Failed') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${saveStatus.includes('Failed') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.9rem',
            color: saveStatus.includes('Failed') ? '#fca5a5' : '#6ee7b7'
          }}>
            {saveStatus}
          </div>
        )}

        {/* KPI Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Source Provider</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8' }}>{detectedProvider}</div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Source Bill Total</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ffb74d' }}>
              {currencySymbol}{totalSourceCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {detectedCurrency}
            </div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Mapping Completeness</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981' }}>
              100% Accounted
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', fontWeight: 400 }}>
                {exactSkuCount} validated • {reviewRequiredCount} review
              </span>
            </div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Target AWS Region</div>
            <select
              value={targetRegion}
              onChange={(e) => handleGlobalRegionChange(e.target.value)}
              style={{
                width: '100%',
                background: '#0f172a',
                color: '#fff',
                border: '1px solid rgba(255, 153, 0, 0.3)',
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {options?.supported_regions?.map(reg => (
                <option key={reg.code} value={reg.code}>{reg.name}</option>
              )) || <option value="ap-south-1">Asia Pacific (Mumbai) [Default]</option>}
            </select>
          </div>
        </div>
      </div>

      {/* Toolbar / Search & Filter */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search source service, AWS service, or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: '#0b1120',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.6rem 0.75rem 0.6rem 2.25rem',
                color: '#fff',
                fontSize: '0.9rem'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['ALL', 'COMPUTE', 'STORAGE', 'DATABASE', 'NETWORKING', 'REVIEW'].map(cat => (
            <button
              key={cat}
              className={`btn ${categoryFilter === cat ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setCategoryFilter(cat)}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.8rem',
                ...(cat === 'REVIEW' && reviewRequiredCount > 0 ? { borderColor: '#f87171', color: '#fca5a5' } : {})
              }}
            >
              {cat === 'REVIEW' ? `REVIEW (${reviewRequiredCount})` : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Resource Edit Table */}
      <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.75rem', width: '24%' }}>Source Workload & Confidence</th>
              <th style={{ padding: '0.75rem', width: '10%' }}>Source Cost</th>
              <th style={{ padding: '0.75rem', width: '18%' }}>Target AWS Service</th>
              <th style={{ padding: '0.75rem', width: '20%' }}>Instance / Spec & Sizing</th>
              <th style={{ padding: '0.75rem', width: '10%' }}>Quantity</th>
              <th style={{ padding: '0.75rem', width: '10%' }}>Target Region</th>
              <th style={{ padding: '0.75rem', width: '8%', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No workloads match the active filter or search criteria.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} style={{
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  transition: 'background 0.2s',
                  background: (item.is_review_required || item.mapping_confidence === 'review_required')
                    ? 'rgba(239, 68, 68, 0.03)'
                    : 'transparent'
                }}>
                  {/* Source Details & Confidence */}
                  <td style={{ padding: '0.85rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                        {item.source_service_name}
                      </span>
                      {renderConfidenceBadge(item.mapping_confidence, item.is_review_required)}
                    </div>
                    {item.source_sku && (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                        SKU: {item.source_sku}
                      </span>
                    )}
                    {item.mapping_rationale && (
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontStyle: 'italic' }}>
                        {item.mapping_rationale}
                      </div>
                    )}
                  </td>

                  {/* Source Cost */}
                  <td style={{ padding: '0.85rem 0.75rem', color: '#ffb74d', fontWeight: 600 }}>
                    {currencySymbol}{item.source_cost?.toFixed(2) || '0.00'}
                  </td>

                  {/* Target AWS Service */}
                  <td style={{ padding: '0.85rem 0.75rem' }}>
                    <select
                      value={item.target_aws_service || 'Amazon EC2'}
                      onChange={(e) => handleResourceChange(item.id, 'target_aws_service', e.target.value)}
                      style={{
                        width: '100%',
                        background: '#0b1120',
                        color: (item.is_review_required || item.mapping_confidence === 'review_required') ? '#f87171' : '#38bdf8',
                        border: (item.is_review_required || item.mapping_confidence === 'review_required') ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(56, 189, 248, 0.3)',
                        borderRadius: '6px',
                        padding: '0.45rem',
                        fontSize: '0.85rem'
                      }}
                    >
                      {options?.available_services?.map(s => (
                        <option key={s.code} value={s.name}>{s.name}</option>
                      )) || (
                        <>
                          <option value="Amazon EC2">Amazon EC2</option>
                          <option value="Amazon EBS">Amazon EBS</option>
                          <option value="Amazon S3">Amazon S3</option>
                          <option value="Amazon RDS">Amazon RDS</option>
                          <option value="Amazon Route 53">Amazon Route 53</option>
                          <option value="AWS Data Transfer">AWS Data Transfer</option>
                          <option value="Amazon VPC">Amazon VPC</option>
                          <option value="AWS Site-to-Site VPN">AWS Site-to-Site VPN</option>
                        </>
                      )}
                    </select>

                    {item.candidate_services && item.candidate_services.length > 0 && (
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        Suggested: {item.candidate_services.slice(0, 2).join(', ')}
                      </div>
                    )}
                  </td>

                  {/* Target Instance Type / Spec */}
                  <td style={{ padding: '0.85rem 0.75rem' }}>
                    <input
                      type="text"
                      value={item.target_aws_instance_type || ''}
                      onChange={(e) => handleResourceChange(item.id, 'target_aws_instance_type', e.target.value)}
                      placeholder="e.g. t3.medium / gp3"
                      style={{
                        width: '100%',
                        background: '#0b1120',
                        color: '#f8fafc',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '0.45rem',
                        fontSize: '0.85rem'
                      }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {item.target_aws_service_code === 'AmazonEC2' && `${item.target_vcpu || 2} vCPU • ${item.target_ram_gb || 4} GB RAM`}
                      {item.target_aws_service_code === 'AmazonEBS' && `${item.target_storage_gb || 100} GB gp3 Volume`}
                      {item.target_aws_service_code === 'AmazonS3' && `${item.target_storage_gb || 50} GB Standard Bucket`}
                      {item.target_aws_service_code === 'AmazonRDS' && `${item.db_engine || 'Database'} Instance`}
                    </div>
                  </td>

                  {/* Target Quantity */}
                  <td style={{ padding: '0.85rem 0.75rem' }}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.target_quantity || 1}
                      onChange={(e) => handleResourceChange(item.id, 'target_quantity', parseFloat(e.target.value) || 1)}
                      style={{
                        width: '80px',
                        background: '#0b1120',
                        color: '#fff',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '0.45rem',
                        fontSize: '0.85rem'
                      }}
                    />
                  </td>

                  {/* Target Region */}
                  <td style={{ padding: '0.85rem 0.75rem' }}>
                    <select
                      value={item.target_aws_region || targetRegion}
                      onChange={(e) => handleResourceChange(item.id, 'target_aws_region', e.target.value)}
                      style={{
                        width: '100%',
                        background: '#0b1120',
                        color: '#fff',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '0.45rem',
                        fontSize: '0.8rem'
                      }}
                    >
                      {options?.supported_regions?.map(reg => (
                        <option key={reg.code} value={reg.code}>{reg.name.split(' ')[0]}</option>
                      )) || <option value="ap-south-1">Mumbai</option>}
                    </select>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Delete workload"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '0.35rem',
                        borderRadius: '4px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
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
        <button className="btn btn-secondary" onClick={onBackToUpload}>
          ← Back to Upload
        </button>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={handleSave} disabled={isSaving}>
            <Save size={16} /> Save Mappings
          </button>
          <button className="btn btn-primary" onClick={() => onProceedToCost && onProceedToCost(resources, targetRegion)}>
            Proceed to Cost Estimator <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
