/**
 * Wire format for events the authority pushes to seats. Shared so the web
 * client can type its event stream without importing the server package.
 */
export interface OutboundEvent {
  type: string;
  payload: unknown;
  /** Owning seat, when the event is about one civilization. */
  civId?: number;
  /** Location of the subject, when the event happens on the map. */
  col?: number;
  row?: number;
  /** Never broadcast beyond the owning seat. */
  seatOnly?: boolean;
  /** Classification rule used for this event. */
  scope?: 'universal' | 'seat' | 'location';
}
