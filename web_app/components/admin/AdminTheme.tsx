"use client";

/** Global admin surface styles — forms, tables, themed scrollbars inside .admin-root */
export function AdminTheme() {
  return (
    <style jsx global>{`
      .admin-root {
        color: #fafafa;
        background: #000;
      }
      /* Dense chrome (nav, compact panels) — keep scrollbar invisible */
      .admin-root .admin-no-scrollbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .admin-root .admin-no-scrollbar::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }
      /* Main page / tab / table scrolls — thin dark theme */
      .admin-root .admin-scrollbar,
      .admin-root .admin-tab-scroll,
      .admin-root .admin-table-scroll,
      .admin-root textarea,
      .admin-root pre {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.22) rgba(255, 255, 255, 0.04);
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar,
      .admin-root .admin-tab-scroll::-webkit-scrollbar,
      .admin-root .admin-table-scroll::-webkit-scrollbar,
      .admin-root textarea::-webkit-scrollbar,
      .admin-root pre::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar-button,
      .admin-root .admin-tab-scroll::-webkit-scrollbar-button,
      .admin-root .admin-table-scroll::-webkit-scrollbar-button,
      .admin-root textarea::-webkit-scrollbar-button,
      .admin-root pre::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar-track,
      .admin-root .admin-tab-scroll::-webkit-scrollbar-track,
      .admin-root .admin-table-scroll::-webkit-scrollbar-track,
      .admin-root textarea::-webkit-scrollbar-track,
      .admin-root pre::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 9999px;
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar-thumb,
      .admin-root .admin-tab-scroll::-webkit-scrollbar-thumb,
      .admin-root .admin-table-scroll::-webkit-scrollbar-thumb,
      .admin-root textarea::-webkit-scrollbar-thumb,
      .admin-root pre::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.18);
        border-radius: 9999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar-thumb:hover,
      .admin-root .admin-tab-scroll::-webkit-scrollbar-thumb:hover,
      .admin-root .admin-table-scroll::-webkit-scrollbar-thumb:hover,
      .admin-root textarea::-webkit-scrollbar-thumb:hover,
      .admin-root pre::-webkit-scrollbar-thumb:hover {
        background: rgba(52, 211, 153, 0.45);
        background-clip: padding-box;
      }
      .admin-root .admin-scrollbar::-webkit-scrollbar-corner,
      .admin-root .admin-tab-scroll::-webkit-scrollbar-corner,
      .admin-root .admin-table-scroll::-webkit-scrollbar-corner,
      .admin-root textarea::-webkit-scrollbar-corner,
      .admin-root pre::-webkit-scrollbar-corner {
        background: transparent;
      }
      .admin-root input:not([type="checkbox"]):not([type="radio"]),
      .admin-root textarea,
      .admin-root select {
        border-radius: 0.75rem;
        border-color: rgba(255, 255, 255, 0.1);
        background-color: rgba(0, 0, 0, 0.5);
      }
      .admin-root input:focus,
      .admin-root textarea:focus,
      .admin-root select:focus {
        border-color: rgba(16, 185, 129, 0.5);
        outline: none;
        box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.25);
      }
      .admin-data-table thead tr {
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .admin-data-table th {
        padding: 0.625rem 1rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.4);
        background: rgba(255, 255, 255, 0.02);
      }
      .admin-data-table td {
        padding: 0.625rem 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.75);
      }
      .admin-data-table tbody tr:hover td {
        background: rgba(255, 255, 255, 0.02);
      }
      .admin-root table:not(.admin-data-table) {
        width: 100%;
      }
      .admin-root table:not(.admin-data-table) thead tr {
        color: rgba(255, 255, 255, 0.4);
      }
      .admin-root table:not(.admin-data-table) tbody tr {
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      .admin-root table:not(.admin-data-table) tbody tr:hover {
        background: rgba(255, 255, 255, 0.02);
      }
    `}</style>
  );
}
