import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Installable as an app (Add to Home Screen / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name}: ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f4ef",
    theme_color: "#13233f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Share photos / screenshots / names from the phone's share sheet into the info-session inbox (api/capture-share;
    // authenticated by the cookie /capture sets). Shows up once the app is installed (Add to Home Screen; Android Chrome).
    share_target: {
      action: "/api/capture-share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["image/*"] }] },
    },
  };
}
