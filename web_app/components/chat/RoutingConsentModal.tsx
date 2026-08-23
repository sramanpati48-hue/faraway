"use client";

import React from "react";
import { AlertTriangle, ExternalLink, Phone, ShieldAlert, X } from "lucide-react";

interface LegalAidSupport {
  enabled?: boolean;
  level?: string;
  reason?: string;
}

interface RoutingRecommendation {
  issue_type?: string;
  state?: string;
  primary_forum?: string;
  secondary_forum?: string;
  routing_message?: string;
  links?: Record<string, string>;
  legal_aid_support?: LegalAidSupport;
}

interface Props {
  routing: RoutingRecommendation | null;
  onClose: () => void;
}

const LABELS: Record<string, string> = {
  police_lost: "Police Lost Report",
  police_theft: "Police Theft/FIR Route",
  police: "State Police Portal",
  ceir: "Block Device on CEIR",
  cybercrime: "National Cybercrime Portal",
  helpline_1930: "Call 1930",
  nalsa: "NALSA",
  legal_aid: "Legal Services Portal",
  state_legal_aid: "State Legal Aid",
};

export function RoutingConsentModal({ routing, onClose }: Props) {
  if (!routing) return null;

  const links = routing.links || {};
  const entries = Object.entries(links).filter(([, value]) => typeof value === "string" && value.trim().length > 0);

  const openLink = (value: string) => {
    const target = value.trim();
    if (target === "1930") {
      window.location.href = "tel:1930";
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const firstAction = entries.find(([, value]) => value && value !== "1930") || entries[0];

  return (
    <div
      className="routing-consent-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="routing-consent-modal">
        <div className="rcm-header">
          <div className="rcm-icon-wrap">
            <ShieldAlert size={22} />
          </div>
          <div>
            <h2 className="rcm-title">Recommended Official Route</h2>
            <p className="rcm-subtitle">{routing.state || "India"}</p>
          </div>
          <button className="rcm-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="rcm-body">
          <div className="rcm-priority-card">
            <p className="rcm-kicker">Primary Forum</p>
            <h3>{routing.primary_forum || "Police/Cyber Route"}</h3>
            {routing.secondary_forum && <p className="rcm-secondary">Secondary: {routing.secondary_forum}</p>}
          </div>

          <div className="rcm-message">
            <AlertTriangle size={16} />
            <span>{routing.routing_message || "Follow the recommended forum sequence for this case."}</span>
          </div>

          {routing.legal_aid_support?.enabled && (
            <div className="rcm-legal-aid">
              <h4>Free legal aid available</h4>
              <p>{routing.legal_aid_support.reason || "Get drafting and filing help if needed."}</p>
            </div>
          )}

          <div className="rcm-links-grid">
            {entries.map(([key, value]) => (
              <button key={key} className="rcm-link-btn" onClick={() => openLink(value)}>
                {value === "1930" ? <Phone size={14} /> : <ExternalLink size={14} />}
                <span>{LABELS[key] || key.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>

          {firstAction && (
            <button className="rcm-primary-btn" onClick={() => openLink(firstAction[1])}>
              Open Recommended Link
            </button>
          )}
        </div>
      </div>

      <style>{`
        .routing-consent-overlay {
          position: fixed;
          inset: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: rcmFade 0.2s ease;
        }
        .routing-consent-modal {
          width: min(580px, 95vw);
          max-height: 90vh;
          overflow-y: auto;
          border-radius: 18px;
          background: linear-gradient(160deg, #12223a 0%, #0d1627 100%);
          border: 1px solid rgba(110, 177, 255, 0.2);
          box-shadow: 0 22px 64px rgba(0, 0, 0, 0.6);
          animation: rcmSlide 0.24s ease;
        }
        .rcm-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 18px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .rcm-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, #2f7de8, #1f4d97);
          color: #d6e8ff;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .rcm-title {
          margin: 0;
          font-size: 17px;
          font-weight: 700;
          color: #e9f2ff;
          line-height: 1.2;
        }
        .rcm-subtitle {
          margin: 2px 0 0;
          font-size: 12px;
          color: #9ec3ff;
        }
        .rcm-close-btn {
          margin-left: auto;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: rgba(255, 255, 255, 0.08);
          color: #afc7e8;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rcm-body {
          padding: 18px 20px 20px;
        }
        .rcm-priority-card {
          border: 1px solid rgba(110, 177, 255, 0.25);
          background: rgba(56, 128, 224, 0.12);
          border-radius: 12px;
          padding: 12px 14px;
        }
        .rcm-kicker {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ec3ff;
        }
        .rcm-priority-card h3 {
          margin: 6px 0 0;
          color: #eef5ff;
          font-size: 15px;
        }
        .rcm-secondary {
          margin: 5px 0 0;
          color: #b8d1f0;
          font-size: 13px;
        }
        .rcm-message {
          margin-top: 12px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(250, 204, 21, 0.11);
          border: 1px solid rgba(250, 204, 21, 0.2);
          color: #fde68a;
          font-size: 13px;
          line-height: 1.45;
        }
        .rcm-message svg {
          flex-shrink: 0;
          margin-top: 1px;
        }
        .rcm-legal-aid {
          margin-top: 12px;
          border-radius: 10px;
          border: 1px solid rgba(74, 222, 128, 0.25);
          background: rgba(74, 222, 128, 0.1);
          padding: 10px 12px;
        }
        .rcm-legal-aid h4 {
          margin: 0 0 4px;
          color: #bbf7d0;
          font-size: 13px;
        }
        .rcm-legal-aid p {
          margin: 0;
          font-size: 12px;
          color: #bde7c8;
          line-height: 1.45;
        }
        .rcm-links-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .rcm-link-btn {
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          color: #d8e7fb;
          font-size: 12px;
          min-height: 40px;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 7px;
          cursor: pointer;
          text-align: left;
        }
        .rcm-link-btn:hover {
          background: rgba(255, 255, 255, 0.12);
        }
        .rcm-primary-btn {
          width: 100%;
          margin-top: 14px;
          border: none;
          border-radius: 11px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
          color: #f0f6ff;
          background: linear-gradient(135deg, #2f7de8, #1d4f9c);
          cursor: pointer;
        }
        .rcm-primary-btn:hover {
          opacity: 0.94;
        }

        @keyframes rcmFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes rcmSlide {
          from { transform: translateY(18px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }

        @media (max-width: 640px) {
          .rcm-links-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
