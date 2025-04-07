import React from 'react';

interface Props {
  percent: number;
}

const ProgressBar: React.FC<Props> = ({ percent }) => {
  return (
    <div className="progress-container">
      <div className="progress-bar">
        <div 
          className="progress-fill" 
          style={{ width: `${percent}%` }}
        ></div>
      </div>
      <div className="progress-text">{Math.round(percent)}%</div>
    </div>
  );
};

export default ProgressBar;
