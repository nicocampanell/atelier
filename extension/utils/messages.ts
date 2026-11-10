// Extension-internal messages beyond the contract's CaptureMessage / CaptureStateMessage.
// None of these ever carries the token.
export type OverlayCommand = { type: "atelier.overlay"; view: "region" | "clear" | "ping" };
export interface RegionResult {
  type: "atelier.region-result";
  rect: { x: number; y: number; w: number; h: number; dpr: number } | null;
}
export interface RetryMessage {
  type: "atelier.retry";
  captureId: string;
}
export interface OpenAppMessage {
  type: "atelier.open-app";
}
export type BackgroundMessage = RegionResult | RetryMessage | OpenAppMessage;
