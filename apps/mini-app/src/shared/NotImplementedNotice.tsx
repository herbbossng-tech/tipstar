export interface NotImplementedNoticeProps {
  readonly moduleName: string;
}

/**
 * The one honest way a placeholder screen may present itself (Section 01
 * — Frontend Foundation): a clear "not yet implemented" notice, never a
 * fabricated value, prediction card, or statistic.
 */
export function NotImplementedNotice({ moduleName }: NotImplementedNoticeProps): JSX.Element {
  return (
    <div className="state state--empty">
      <p className="state__title">{moduleName} is not yet implemented</p>
      <p className="state__message">This module is part of a later section of the build.</p>
    </div>
  );
}
