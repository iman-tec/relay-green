import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/*
 * Favicon, the green dot on cream. Generated dynamically so it inherits
 * brand tokens without needing static asset round-trips.
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f4ee",
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: "#3dcb7e",
        }}
      />
    </div>,
    { ...size }
  );
}
