import * as BUI from "@thatopen/ui";

/**
 * Platform-matching file-format glyphs, ported from the platform's own file
 * browser (platform_backend-api .../util/fileIcons). The platform's icons are
 * NOT iconify/mdi, so they can't go through bim-icon:
 *  - ifc / gltf are raster PNG assets — inlined here as data URIs and drawn the
 *    same way the platform does (`<image>` in a 24×24 SvgIcon, x/y 2, 20×20).
 *  - json replicates the platform's `FileExtensionLabel` badge (rounded rect +
 *    centered text), same geometry/colors.
 *  - anything the platform doesn't map (e.g. .frag) falls back to the platform's
 *    generic file icon (MUI InsertDriveFileOutlined path), muted gray.
 *
 * Covered: ifc, gltf/glb, json, generic fallback. More platform formats
 * (xml/yaml/csv/doc/xls badges, png/jpg/pdf…) are easy one-liners to add — each
 * just needs its label+color or PNG ported the same way.
 */

// Inlined from platform_backend-api/src/client/src/assets/icons/ifc.png
const IFC_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAHqADAAQAAAABAAAAHgAAAADKQTcFAAAIbklEQVRIDYVWC1hUxxU+c+++kIcrCwiJGIpS28REW2wgBVk0nyUYESPyKD4CpoIk6cOm1tivVdSY+Gj9UkxY1piwQYTUxCTEfLFC5JVUIaYBDFZE8YURFOQRQVl270zP3N27LKv9Ot9378z88885Z86cOTME/m9hBDIOzwaR/hCo0ALly9o8p9TEx6tmXRtJBBGi7IydCGpv/MyT49knnsC4fs7Xahju2AUg/A6AOYaIuAlKU7YpPDYjxrefSmVA2CIFw3qff3tjrlv/nub/Vpxfo4L2XgsKXA7gQWPkt1C2rKAHlYrM9ikwEod+QSqa56Ri9SYqf/EejU7AQ6ITXXfIC27AUSDECAylEaQptUsSyek7tXsVwrGyXdwhXJqTzmk4tttwvvGPvO1ZBE8AVhwIgR5yTFbKB7lSgEGsS3nDrZgzIp5pQGW9nIGCrjHuCYARN876/ojoP7v1Xc3xijMqHgCmrUGr57oYwHqBCPPhYOpKVLLFDSeV+mnr8kONJQxYOyHUGHC+oUAgjO+tnfO4zZSwbX0Rj9+zank5srDsj0Nh1FaL7XC5L/9YF6iEBfDusjO8ezM8KiIyMmdDp8bvOReHsUEViIvtZSn1CtY3PToPBFaoeJ/jAiF5+nMNRQrHseKsj8LAOlqHoJtScgWYzagoHZ4R84BKhONNLeZZD44OHVAE4LIm2gmtgPT3ZiqY/4UGExNgPQ82XnjFGNs7OCNqhQzgT4AMVGqz16KAHygg0i7guY2DsuXnFWwU7E+hq0MFIHO+bTY95CONVihjWOtBJe5z64OhrfGvGOGblVVTAJWdwVv9P4qO5zwBBNuvUdFDDrsQIawV1LjHJWlXOUEpElCt0maExLU3vaHVMulzBcM6EnKOTHDrg6G9cSsBtpNjfE/x0zHKyllkpBoXQAzuZIyGHWBJ61Ywy3zztH3GwsQz3j+rxanXOc6FoISnzjYV3kLBjRxDf56GWJsPlHyaAZbDcTKGv0nnGjfi2DdOr3M4uG9ACMY9pjUuezhMwASZHz3Om2ajafuInbYzED5r85114l+T5h/E8T7HpqF/7db0lmbzWcS+hJ+ojgKIuDVSOQiqOjhQYYkvLtb1zYgqxvGfcnlyIdDtr6fdInz7QQs8lqZHk6OdQ1qR0FCT/5NGXBmmSvSJfJaZrm1CYPNxX6/KubevRuOYBgWCH7UGVCya+W5vkA9PozqnDPC1jV6q/lthupqyNO4hXtA7FI/eSxNavz4lykjKI1XQFxSGQ7O1lFXtvD5gVzOWwQXzwquLGrXp1WB9wkmfKYmTJGvRnKEu7pXOhOzsytPBwRucNKwAQm4PlbTteX2KRqILxpTC95gPfmVo/8rCOQoOkHpIo1PBy3uu98eIQH/BBx2F2M7o1HsLDL6puPZQB8b6CzuO7jEvjZrWMjkkS5biDN+IW7feaTSZ52D3MS7cCQ/h8UrBSK90CgWV0jB39xvw0D+DzNmoQJ6Bk+7U+epeLdd7/wZ5QQoX6+4uv1gDGfEZcJmOUx7tvmGp2f82D6zpnOtQSnpylyRZ3n905hOwMtmlWF6xOdY8FZVicLCHHU7AnQDo+1DvU1Dpq/09Yn5cEC+4N1/ldw1cCJKkTEwKnTuSA6suB6pWx1zp3PvJgdIkFBgmE/GHMr5Lzcz4sDo8/Hl5qiBshBVJO/g4KU0s9RseHmpCVeGOIOIw9BXrvXc1+Ojyse0IGH47iVCz+9pAgx+lGzmJF5x3uWaWfavpn6XbsRsig/hDAy6tS1y4wRI5+5CCyTUTXoJnk/YIw3eGsxhBpQ4U/+yqmmrmNkzUlmO7WYYJs6H734H52u+3/zJoCmYkPLvckVwBCZvXot40oPY/gh4YQBQfIXCSaqjR8vfN72OO+pNMVH4C3QTmIwECpXQyTpZNlMeIULb6i9X/kTPXwbQnQFLjNqhCIEE8iHkueUBHVuYvDTyLN74rneLssKqAxaH+flIQsdsD8A7+uaH1VKcsb1XSa1gfU/SivRPBi0QKKgLHEcRU6iyM/mF/nDlT6cJ7SzqhZOkttGyqgnVPVGX9JX1yFa7unHPh6ACS8KY+28//4r8HFZ5cl36yCeuEMYzY8cZoFdbU51UTELYwvmr+MaKSCCt9K65o4RgZW6KmBvO4zYExuOkrPL8lJbAWp3TIGIHb3pL38Lg5pRU7gbIt4zDCtuIefydfizl1OVsFJuyUnzechU8JSuCwaa5pzNLlT+M1KWcytI8bCdClV+XuWBxQjfhVNHhbdm228vogYPn4DfSj+wMA45C9jEeKZzh5mbyWi9lYtAsb651dHj/9FNiTefV5TQoW+voHpk6DOhfHHNrRDQG3bZt7X3C+PA+d8IK7N/ejcWPbhQkc578Iq5JdDwHnZIfYfMgXQuKDC1DoC1yr065efL7MuwE32oJZcCFOWPDa4oDaywHqLEW1PJuSdLCOHAMv7T+wn+CaTuAuXsXPwcqn8ZSMlXGKOVwcX6wbZdYSbKYqNAq0G+PgS0zyyxzGkEuvLAms7zSIzyocVGRFYy/iSn/swgDzM4UkyEqu59i0qVNjGKiIN9jP3KOYE/LzceXVIdUY7Eb+TpZJsgNcdCsGR9KaNQ8uAkp5Or1PIT2oIxkyk07ywYenTn/kLkgxaLyXIKia5eDynIWKKZ62hZjJvpDPOFftDCjUP4jfvDV1a6sw/fFrc5/nfAyiTtDYYxWlfNxKmVUgQg8w6YQkSfS+ijkx90juHULETFTyDWYkHun8u47teWvr1sqrQBqDUD+MB1LA58iFsdMgSfGQsbRdgXjdca3jAr6z2gRR9NZM0DS7fOdO8miTImNRtArPmyQKrbmf545PEAr5bXyTi9QLLrdcwb2S39XK0P3q/wL5WCCmp1i6FwAAAABJRU5ErkJggg==";

// Inlined from platform_backend-api/src/client/src/assets/icons/gltf.png
const GLTF_PNG =
  "data:image/png;base64,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";

const SIZE = "1rem";
const SVG_STYLE =
  "flex-shrink: 0; display: inline-block; vertical-align: middle;";

const pngGlyph = (dataUri: string, title: string) => BUI.html`
  <svg viewBox="0 0 24 24" width=${SIZE} height=${SIZE} style=${SVG_STYLE}>
    <title>${title}</title>
    <image href=${dataUri} x="2" y="2" width="20" height="20"></image>
  </svg>`;

const labelGlyph = (label: string, bg: string) => BUI.html`
  <svg viewBox="0 0 24 24" width=${SIZE} height=${SIZE} style=${SVG_STYLE}>
    <title>${label}</title>
    <rect x="1" y="4" width="22" height="16" rx="3" fill=${bg}></rect>
    <text
      x="12" y="14.5" text-anchor="middle" fill="#FFFFFF"
      font-size=${label.length > 3 ? "6" : "7"} font-weight="700"
      font-family="Arial, sans-serif"
    >${label}</text>
  </svg>`;

// Fragments (.frag) — the official ThatOpen isotype (the green brand mark,
// extracted from the platform's HeaderLogoIcon — just the two mark paths, no
// wordmark), in the brand colour #BCF124.
const fragGlyph = () => BUI.html`
  <svg viewBox="0 0 32 40" width=${SIZE} height=${SIZE} style=${SVG_STYLE}>
    <title>Fragments</title>
    <path
      fill="#BCF124"
      d="M7.00861 16.1097H0C0.00583172 11.8399 1.68502 7.74676 4.66939 4.7276C7.65377 1.70845 11.6998 0.0096915 15.9203 0.00379181V7.09409C13.558 7.09802 11.2935 8.04914 9.62308 9.73903C7.95266 11.4289 7.0125 13.7198 7.00861 16.1097Z"
    ></path>
    <path
      fill="#BCF124"
      d="M15.9243 39.3095C11.7037 39.3036 7.65771 37.6048 4.67333 34.5856C1.68896 31.5665 0.00976849 27.4733 0.00393677 23.2036H7.01255C7.01255 24.9874 7.53543 26.7312 8.51506 28.2144C9.4947 29.6976 10.8871 30.8537 12.5162 31.5363C14.1452 32.219 15.9378 32.3976 17.6672 32.0496C19.3966 31.7016 20.9852 30.8426 22.2321 29.5812C23.4789 28.3198 24.328 26.7127 24.672 24.9632C25.016 23.2136 24.8394 21.4001 24.1647 19.7521C23.4899 18.104 22.3472 16.6954 20.881 15.7043C19.4149 14.7133 17.6912 14.1843 15.9279 14.1843V7.09029C20.1512 7.09029 24.2016 8.78754 27.1879 11.8087C30.1742 14.8298 31.8519 18.9273 31.8519 23.1999C31.8519 27.4724 30.1742 31.5699 27.1879 34.5911C24.2016 37.6122 20.1512 39.3095 15.9279 39.3095H15.9243Z"
    ></path>
  </svg>`;

// 3D Tiles archive (.3tz) — a tiled-format badge, drawn the same way as the
// JSON/label glyphs (rounded rect + centered text), in the platform's tiles/
// reality-capture accent (teal). Mirrors fragGlyph()/labelGlyph() style; swap
// for a brand isotype later if the platform ships one.
const threetzGlyph = () => labelGlyph("3TZ", "#26A69A");

const genericGlyph = () => BUI.html`
  <svg viewBox="0 0 24 24" width=${SIZE} height=${SIZE} style=${SVG_STYLE}>
    <path
      fill="var(--bim-ui_bg-contrast-60, #9a9a9a)"
      d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"
    ></path>
  </svg>`;

/** Leading file-format glyph for a row, matching the platform's file browser. */
export const formatGlyph = (ext: string) => {
  switch (ext) {
    case "ifc":
      return pngGlyph(IFC_PNG, "IFC");
    case "gltf":
    case "glb":
      return pngGlyph(GLTF_PNG, "glTF");
    case "frag":
      return fragGlyph();
    case "3tz":
      return threetzGlyph();
    case "json":
      return labelGlyph("JSON", "#FF7043");
    default:
      return genericGlyph();
  }
};
