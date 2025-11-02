import React, { useState, useEffect } from 'react';
import { ProgressBar } from 'react-bootstrap';

const LoadingScreen = () => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');

  const loadingSteps = [
    { progress: 10, status: 'Loading game constants...' },
    { progress: 25, status: 'Initializing hex grid system...' },
    { progress: 40, status: 'Generating world map...' },
    { progress: 55, status: 'Placing civilizations...' },
    { progress: 70, status: 'Creating starting units...' },
    { progress: 85, status: 'Setting up AI systems...' },
    { progress: 100, status: 'Ready to play!' }
  ];

  useEffect(() => {
    let stepIndex = 0;
    
    const progressInterval = setInterval(() => {
      if (stepIndex < loadingSteps.length) {
        const step = loadingSteps[stepIndex];
        setProgress(step.progress);
        setStatus(step.status);
        stepIndex++;
      } else {
        clearInterval(progressInterval);
      }
    }, 500);

    return () => clearInterval(progressInterval);
  }, []);

  return (
    <div className="loading-screen">
      <div className="container-fluid text-center px-3">
        <h1 className="loading-title">
          <i className="bi bi-globe2"></i>
          <br />
          <span className="d-block d-sm-inline">Civilization</span>
          <span className="d-block d-sm-inline"> Browser</span>
        </h1>
        
        <div className="loading-progress mb-3 mx-auto" style={{ maxWidth: '400px' }}>
          <ProgressBar 
            now={progress} 
            variant="warning"
            animated
            className="loading-progress-bar"
            style={{ height: '12px' }}
          />
        </div>
        
        <div className="loading-status mb-4">
          <i className="bi bi-hourglass-split me-2"></i>
          {status}
        </div>
        
        {/* Mobile tips */}
        <div className="mt-4">
          <div className="row text-center">
            <div className="col-12 col-md-4 mb-3 mb-md-0">
              <small className="text-light">
                <i className="bi bi-hand-index d-block mb-1"></i>
                <strong>Tap</strong> to select
              </small>
            </div>
            <div className="col-12 col-md-4 mb-3 mb-md-0">
              <small className="text-light">
                <i className="bi bi-arrows-move d-block mb-1"></i>
                <strong>Drag</strong> to pan
              </small>
            </div>
            <div className="col-12 col-md-4">
              <small className="text-light">
                <i className="bi bi-zoom-in d-block mb-1"></i>
                <strong>Pinch</strong> to zoom
              </small>
            </div>
          </div>
          
          <div className="mt-3">
            <small className="text-light">
              Building your empire since 4000 BC...
            </small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;