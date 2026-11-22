import React from 'react';

interface PageHeaderProps {
  /** title 是页面主标题，所有内页（在线聊天除外）共用同一字号与字重。 */ title: string;
  /** description 是标题下方的副标题，说明页面用途；为空时不渲染。 */ description?: React.ReactNode;
  /** children 是标题右侧的操作区（按钮、筛选等），窄屏下换到标题下方。 */ children?: React.ReactNode;
}

// PageHeader 渲染内页统一的标题区，保证标题、副标题与操作区在所有页面风格一致。
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, children }) => (
  <header className="console-page-header">
    <div className="console-page-heading">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {children && <div className="console-page-actions">{children}</div>}
  </header>
);
