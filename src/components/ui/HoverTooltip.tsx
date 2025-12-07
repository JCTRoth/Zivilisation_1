import React from 'react';

interface HoverTooltipProps {
  children: React.ReactNode;
  text: string;
}

export const HoverTooltip = ({ children, text }: HoverTooltipProps): JSX.Element => {
  return (
    <span className="hover-tooltip-wrapper">
      {children}
      <span className="hover-tooltip-text">{text}</span>
    </span>
  );
};

export default HoverTooltip;
