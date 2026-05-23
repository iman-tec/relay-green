import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/*
 * Apple touch icon, used by iOS "Add to Home Screen". Cream background,
 * green dot in the center, matching the favicon.
 */
export default function AppleIcon() {
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
          width: 96,
          height: 96,
          borderRadius: 999,
          background: "#3dcb7e",
        }}
      />
    </div>,
    { ...size }
  );
}
