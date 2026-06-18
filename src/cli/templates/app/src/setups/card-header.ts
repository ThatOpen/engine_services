import * as BUI from "@thatopen/ui";

/**
 * A card title styled to match the nxt-bld-demo panels: an icon (#99A0AE) +
 * a white→#99A0AE gradient text label, semibold with wide letter-spacing.
 * Use inside a `header-hidden` `bim-panel` (replaces the default header). Sticky
 * to the top so it stays put while the card body scrolls.
 *
 * @param icon iconify/mdi name (e.g. "mdi:file-tree")
 * @param label the title text
 * @param padLeft left padding so the title aligns with the card's content inset
 */
export const cardHeader = (icon: string, label: string, padLeft = "0.6rem") => BUI.html`
  <div
    style="
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 0.45rem;
      padding: 0.4rem 0.6rem 0.4rem ${padLeft};
      font-size: 0.8rem; font-weight: 600; letter-spacing: 0.04em;
      /* Opaque surface bg (#262629 = panel bg) so scrolled content doesn't show
         behind the sticky title. */
      background: var(--bim-ui_bg-contrast-10, #262629);
      border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1));
    "
  >
    <bim-icon icon=${icon} style="color: #99A0AE; font-size: 0.95rem;"></bim-icon>
    <span
      style="
        background: linear-gradient(90deg, #ffffff 0%, #99a0ae 100%);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
      "
    >${label}</span>
  </div>
`;
