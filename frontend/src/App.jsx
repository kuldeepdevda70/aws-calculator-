import React, { useState } from 'react';
import { 
  CloudUpload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Globe, 
  Database, 
  Layers,
  ArrowRight,
  RefreshCw,
  Code2,
  Cpu,
  Calculator,
  Sparkles
} from 'lucide-react';
import ResourceEditScreen from './components/ResourceEditScreen';
import CostCalculationScreen from './components/CostCalculationScreen';

export default function App() {
  const [currentStep, setCurrentStep] = useState(1); // 1: Upload, 2: Edit/Map, 3: Cost Preview
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [mappedResources, setMappedResources] = useState([]);
  const [targetRegion, setTargetRegion] = useState('ap-south-1');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'json'

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (selectedFile) => {
    setFile(selectedFile);
    setError(null);
    setParsedData(null);
    setMappedResources([]);
  };

  const uploadAndParse = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to process document');
      }

      setParsedData(data);
      setMappedResources(data.mapped_resources || []);
      if (data.default_target_aws_region) {
        setTargetRegion(data.default_target_aws_region);
      }
      // Advance to Phase 2 (Edit & Mapping Screen)
      setCurrentStep(2);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message || 'Error uploading and processing bill');
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setParsedData(null);
    setMappedResources([]);
    setError(null);
    setCurrentStep(1);
  };

  const handleProceedToCost = (updatedResources, region) => {
    setMappedResources(updatedResources);
    setTargetRegion(region);
    setCurrentStep(3);
  };

  return (
    <div className="container">
      {/* Global Header */}
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="badge badge-aws">
            {currentStep === 1 ? 'Phase 1: Ingestion' : currentStep === 2 ? 'Phase 2: AWS Mapping & Edit' : 'Phase 3: Cost Preview'}
          </span>
          <span className="badge badge-info"><Globe size={13} /> Region: {targetRegion} (Mumbai Default)</span>
          <span className="badge badge-success"><Clock size={13} /> 24h Auto-Purge Active</span>
        </div>
        <h1 style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
          Cloud to AWS <span style={{ color: 'var(--accent-aws)' }}>Migration Cost Estimator</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.02rem', maxWidth: '680px', margin: '0 auto' }}>
          Convert third-party cloud bills (Azure, GCP, DigitalOcean) into equivalent AWS architectures and accurate monthly pricing estimates.
        </p>

        {/* Phase Progress Stepper */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1rem',
          marginTop: '1.75rem',
          flexWrap: 'wrap'
        }}>
          <div
            onClick={() => parsedData && setCurrentStep(1)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: parsedData ? 'pointer' : 'default',
              padding: '0.4rem 0.85rem',
              borderRadius: '20px',
              background: currentStep === 1 ? 'rgba(255, 153, 0, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${currentStep === 1 ? 'var(--accent-aws)' : 'transparent'}`,
              color: currentStep === 1 ? '#ffb74d' : 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: currentStep >= 1 ? 'var(--accent-aws)' : '#475569', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>1</span>
            Upload Bill
          </div>

          <span style={{ color: 'var(--border-color)' }}>→</span>

          <div
            onClick={() => parsedData && setCurrentStep(2)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: parsedData ? 'pointer' : 'default',
              padding: '0.4rem 0.85rem',
              borderRadius: '20px',
              background: currentStep === 2 ? 'rgba(255, 153, 0, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${currentStep === 2 ? 'var(--accent-aws)' : 'transparent'}`,
              color: currentStep === 2 ? '#ffb74d' : 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: currentStep >= 2 ? 'var(--accent-aws)' : '#475569', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>2</span>
            AWS Architecture Mapping & Edit
          </div>

          <span style={{ color: 'var(--border-color)' }}>→</span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.85rem',
              borderRadius: '20px',
              background: currentStep === 3 ? 'rgba(255, 153, 0, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${currentStep === 3 ? 'var(--accent-aws)' : 'transparent'}`,
              color: currentStep === 3 ? '#ffb74d' : 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: currentStep >= 3 ? 'var(--accent-aws)' : '#475569', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>3</span>
            Cost Calculation (Phase 3)
          </div>
        </div>
      </header>

      {/* STEP 1: Upload Bill Panel */}
      {currentStep === 1 && (
        <div className="glass-panel" style={{ maxWidth: '780px', margin: '0 auto' }}>
          <div
            className={`dropzone ${isDragging ? 'active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input-hidden').click()}
          >
            <input
              id="file-input-hidden"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <div style={{
                background: 'rgba(255, 153, 0, 0.1)',
                padding: '1.25rem',
                borderRadius: '50%',
                border: '1px solid rgba(255, 153, 0, 0.25)',
                color: 'var(--accent-aws)'
              }}>
                <CloudUpload size={40} />
              </div>
            </div>

            <h3 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
              {file ? file.name : 'Select or drop your cloud invoice'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Supports PDF documents, images (PNG, JPG), and spreadsheet exports (Excel, CSV)
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                <FileText size={12} /> Multi-page PDF & Textract
              </span>
              <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
                <Database size={12} /> Pandas: Excel / CSV
              </span>
            </div>
          </div>

          {error && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {file && (
            <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Ready to parse: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
              </span>
              <button
                className="btn btn-primary"
                onClick={uploadAndParse}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Processing Invoice...
                  </>
                ) : (
                  <>
                    Parse Bill & Map to AWS <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Phase 2 Interactive Edit & Mapping Screen */}
      {currentStep === 2 && parsedData && (
        <ResourceEditScreen
          initialResources={mappedResources}
          detectedProvider={parsedData.detected_provider || 'Cloud Workload'}
          currencySymbol={parsedData.currency_symbol || '$'}
          detectedCurrency={parsedData.detected_currency || 'USD'}
          initialRegion={targetRegion}
          onProceedToCost={handleProceedToCost}
          onBackToUpload={() => setCurrentStep(1)}
        />
      )}

      {/* STEP 3: Phase 3 AWS Cost Calculation & Excel/PDF Export Screen */}
      {currentStep === 3 && (
        <CostCalculationScreen
          resources={mappedResources}
          targetRegion={targetRegion}
          currencySymbol={parsedData?.currency_symbol || '$'}
          detectedCurrency={parsedData?.detected_currency || 'USD'}
          onBackToEdit={() => setCurrentStep(2)}
          onProceedToPhase4={() => alert('Phase 4: Browser automation with Playwright to generate calculator.aws shareable link will be implemented next!')}
        />
      )}

    </div>
  );
}
