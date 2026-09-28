import { NotImplementedError, type ISODateString } from "@sport-os/shared";

export interface TicketStatistics {
  readonly totalTickets: number;
  readonly wonTickets: number;
  readonly lostTickets: number;
  readonly voidTickets: number;
  readonly pendingTickets: number;
}

export interface SettlementStatistics {
  readonly totalSettled: number;
  readonly winRate: number;
}

export interface ReportCard {
  readonly title: string;
  readonly generatedAt: ISODateString;
  readonly ticketStatistics: TicketStatistics;
  readonly settlementStatistics: SettlementStatistics;
}

export interface WeeklyReport {
  readonly weekStart: ISODateString;
  readonly weekEnd: ISODateString;
  readonly card: ReportCard;
}

export interface WeeklyReportRange {
  readonly weekStart: ISODateString;
  readonly weekEnd: ISODateString;
}

/**
 * ReportingService — generates report cards from real settled data.
 * Report-card rendering and real statistics are deferred: they require
 * settled tickets, which requires the Settlement Engine and a database
 * (Section 03+). No fabricated statistics are produced here.
 */
export interface ReportingService {
  generateWeeklyReport(range: WeeklyReportRange): Promise<WeeklyReport>;
}

export class NotImplementedReportingService implements ReportingService {
  async generateWeeklyReport(_range: WeeklyReportRange): Promise<WeeklyReport> {
    throw new NotImplementedError("ReportingService.generateWeeklyReport");
  }
}
