"use client";

import React, { useState, useEffect } from "react";
import {
  MapPin,
  Phone,
  Mail,
  Star,
  X,
  Landmark,
  CheckCircle2,
  Globe,
  History,
  Loader2,
} from "lucide-react";
import { forwardToNodalGuide } from "@/lib/nyaysahayakApi";


interface NodalGuideProfile {
  uid: string;
  id?: string;
  name: string;
  location: string;
  state?: string;
  occupation: string;
  bio: string;
  avatar: string;
  contact_number: string;
  email: string;
  availability: string;
  rating: number;
  cases_resolved: number;
  languages: string[];
  institution_name?: string;
  regional_name?: string;
  forum_label?: string;
  forum_note?: string;
}

interface Props {
  profiles: NodalGuideProfile[];
  caseId: string | null;
  sessionId: string;
  userId: string;
  stateName?: string;
  forum?: {
    institution_name?: string;
    regional_name?: string;
    label?: string;
    note?: string;
    state?: string;
  } | null;
  onConnect: (profile: NodalGuideProfile, forward?: any) => void;
  onClose: () => void;
}

const FALLBACK_AVATAR = "https://ui-avatars.com/api/?name=Nodal+Guide&background=2d5a4e&color=fff&size=128";

export function NodalGuideBrowserPanel({
  profiles,
  caseId,
  sessionId,
  userId,
  stateName,
  forum,
  onConnect,
  onClose,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(profiles[0]?.uid || profiles[0]?.id || "");
  const guide = profiles.find((p) => (p.uid || p.id) === selectedId) || profiles[0] || null;
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [imgSrc, setImgSrc] = useState<string>(guide?.avatar || FALLBACK_AVATAR);

  useEffect(() => {
    setImgSrc(guide?.avatar || FALLBACK_AVATAR);
  }, [guide?.avatar]);

  useEffect(() => {
    setConsent(false);
    setConnected(false);
    setError(null);
  }, [selectedId]);

  const forumTitle =
    forum?.institution_name ||
    guide?.institution_name ||
    guide?.forum_label ||
    forum?.label ||
    "Local justice body";
  const forumRegional = forum?.regional_name || guide?.regional_name || "";
  const forumNote =
    forum?.note ||
    guide?.forum_note ||
    "This grassroots forum handles petty local disputes in your area.";
  const subtitle = forumRegional
    ? `${forumRegional} · free local assistance`
    : "Free local legal assistance";

  const handleConnect = async () => {
    if (!guide) return;
    if (!consent) {
      setError("Please tick the consent box to forward your case details.");
      return;
    }
    if (!userId) {
      setError("Please log in to forward your case to the nodal guide.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await forwardToNodalGuide({
        guideId: String(guide.id || guide.uid),
        sessionId,
        caseId,
        state: stateName || guide.state || forum?.state,
      });
      setConnected(true);
      onConnect(guide, data.forward);
    } catch (e: any) {
      setError(e?.message || "Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    /* ── Backdrop ── */
    <div
      className="nodal-guide-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* ── Modal Card ── */}
      <div className="nodal-guide-modal">
        {/* Header */}
        <div className="ngp-header">
          <div className="ngp-header-icon">
            <Landmark size={22} />
          </div>
          <div>
            <h2 className="ngp-title">{forumTitle}</h2>
            <p className="ngp-subtitle">{subtitle}</p>
          </div>
          <button className="ngp-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* No profiles state */}
        {!guide ? (
          <div className="ngp-empty">
            <Landmark size={42} className="ngp-empty-icon" />
            <p>No Nodal Guide available in your area right now.</p>
            <p className="ngp-empty-sub">Please check back later or contact your district court.</p>
            <button className="ngp-btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* Local forum details */}
            <div className="ngp-forum-card">
              <p className="ngp-forum-kicker">Local forum near you</p>
              <h3 className="ngp-forum-name">{forumTitle}</h3>
              {forumRegional ? <p className="ngp-forum-regional">{forumRegional}</p> : null}
              <p className="ngp-forum-note">{forumNote}</p>
              {(stateName || forum?.state || guide.state) && (
                <p className="ngp-forum-state">
                  <MapPin size={13} /> {stateName || forum?.state || guide.state}
                </p>
              )}
            </div>

            {/* Guide Card */}
            <div className="ngp-guide-card">
              <p className="ngp-forum-kicker" style={{ marginBottom: 10 }}>Assigned nodal guide</p>
              <div className="ngp-guide-row">
              <div className="ngp-guide-avatar-wrap">
                {/* Plain <img> so onError fallback doesn't loop with next/image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={guide.name}
                  width={88}
                  height={88}
                  className="ngp-guide-avatar"
                  onError={() => setImgSrc(FALLBACK_AVATAR)}
                />
                <span className={`ngp-availability-dot ${guide.availability === "Available" ? "available" : "busy"}`} />
              </div>

              <div className="ngp-guide-info">
                <h3 className="ngp-guide-name">{guide.name}</h3>
                <p className="ngp-guide-occupation">{guide.occupation || forumTitle}</p>

                <div className="ngp-guide-meta">
                  <span className="ngp-meta-item">
                    <MapPin size={13} /> {guide.location}
                  </span>
                  {guide.rating > 0 && (
                    <span className="ngp-meta-item">
                      <Star size={13} className="ngp-star" /> {guide.rating.toFixed(1)}
                    </span>
                  )}
                  {guide.cases_resolved > 0 && (
                    <span className="ngp-meta-item">
                      <History size={13} /> {guide.cases_resolved} cases
                    </span>
                  )}
                </div>

                {guide.bio && <p className="ngp-guide-bio">{guide.bio}</p>}

                <div className="ngp-contact-row">
                  {guide.contact_number && (
                    <a href={`tel:${guide.contact_number}`} className="ngp-contact-chip">
                      <Phone size={13} /> {guide.contact_number}
                    </a>
                  )}
                  {guide.email && (
                    <a href={`mailto:${guide.email}`} className="ngp-contact-chip">
                      <Mail size={13} /> Email
                    </a>
                  )}
                </div>

                {guide.languages?.length > 0 && (
                  <div className="ngp-lang-row">
                    <Globe size={13} />
                    {guide.languages.map((l) => (
                      <span key={l} className="ngp-lang-chip">{l}</span>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>

            {profiles.length > 1 && (
              <div className="ngp-guide-list">
                {profiles.map((p) => {
                  const pid = p.uid || p.id;
                  const active = pid === (guide?.uid || guide?.id);
                  return (
                    <button
                      key={pid}
                      type="button"
                      className={`ngp-guide-chip ${active ? "active" : ""}`}
                      onClick={() => setSelectedId(String(pid))}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Consent — unticked by default */}
            <label className="ngp-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  if (e.target.checked) setError(null);
                }}
              />
              <span>
                I consent to forward my case summary and contact details to this nodal guide for
                review in the local forum queue.
              </span>
            </label>

            {/* Error */}
            {error && <p className="ngp-error">{error}</p>}

            {/* CTA */}
            {connected ? (
              <div className="ngp-connected-msg">
                <CheckCircle2 size={20} />
                <span>
                  Forwarded — waiting for review by <strong>{guide.name}</strong> in the local forum queue.
                </span>
              </div>
            ) : (
              <button
                className="ngp-connect-btn"
                onClick={handleConnect}
                disabled={loading || !consent}
              >
                {loading ? (
                  <><Loader2 size={18} className="ngp-spinner" /> Forwarding…</>
                ) : (
                  <><Landmark size={18} /> Forward to nodal guide</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      <style>{`
        .nodal-guide-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: ngpFadeIn 0.2s ease;
        }
        @keyframes ngpFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .nodal-guide-modal {
          background: linear-gradient(145deg, #1a2e28, #0f1f1b);
          border: 1px solid rgba(78, 160, 120, 0.25);
          border-radius: 20px;
          padding: 0;
          width: min(520px, 95vw);
          max-height: 92vh;
          overflow-y: auto;
          box-shadow: 0 28px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(78,160,120,0.1);
          animation: ngpSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes ngpSlideUp {
          from { transform: translateY(30px) scale(0.96); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        .ngp-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .ngp-header-icon {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: linear-gradient(135deg, #2d8a5e, #1d6044);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a8f0d0;
          flex-shrink: 0;
        }
        .ngp-title {
          font-size: 16px;
          font-weight: 700;
          color: #e8f5f0;
          margin: 0;
          line-height: 1.2;
        }
        .ngp-subtitle {
          font-size: 12px;
          color: #6db890;
          margin: 2px 0 0;
        }
        .ngp-close-btn {
          margin-left: auto;
          background: rgba(255,255,255,0.06);
          border: none;
          color: #8ba99e;
          border-radius: 8px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .ngp-close-btn:hover { background: rgba(255,255,255,0.12); color: #e0f0ea; }

        .ngp-guide-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px 20px;
          margin: 0 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
        }
        .ngp-guide-row {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .ngp-forum-card {
          margin: 16px 20px 0;
          background: rgba(45, 138, 94, 0.12);
          border: 1px solid rgba(78, 160, 120, 0.28);
          border-radius: 14px;
          padding: 14px 16px;
        }
        .ngp-forum-kicker {
          margin: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #6db890;
        }
        .ngp-forum-name {
          margin: 6px 0 0;
          font-size: 15px;
          font-weight: 700;
          color: #e8f5f0;
        }
        .ngp-forum-regional {
          margin: 2px 0 0;
          font-size: 12px;
          color: #a8f0d0;
        }
        .ngp-forum-note {
          margin: 8px 0 0;
          font-size: 12px;
          line-height: 1.45;
          color: #9bb8ad;
        }
        .ngp-forum-state {
          margin: 8px 0 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #6db890;
        }
        .ngp-consent {
          margin: 14px 20px 0;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 12px;
          line-height: 1.45;
          color: #c5ddd3;
          cursor: pointer;
        }
        .ngp-consent input {
          margin-top: 2px;
          width: 16px;
          height: 16px;
          accent-color: #2d8a5e;
          flex-shrink: 0;
        }
        .ngp-connect-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ngp-guide-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .ngp-guide-avatar {
          width: 88px;
          height: 88px;
          border-radius: 14px;
          object-fit: cover;
          border: 2px solid rgba(78,160,120,0.3);
        }
        .ngp-availability-dot {
          position: absolute;
          bottom: 5px;
          right: 5px;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          border: 2px solid #1a2e28;
        }
        .ngp-availability-dot.available { background: #4ade80; }
        .ngp-availability-dot.busy      { background: #f59e0b; }

        .ngp-guide-info { flex: 1; min-width: 0; }
        .ngp-guide-name {
          font-size: 17px;
          font-weight: 700;
          color: #e8f5f0;
          margin: 0 0 3px;
        }
        .ngp-guide-occupation {
          font-size: 13px;
          color: #6db890;
          margin: 0 0 10px;
        }
        .ngp-guide-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 10px;
        }
        .ngp-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #8ba99e;
        }
        .ngp-star { color: #f59e0b; }
        .ngp-guide-bio {
          font-size: 13px;
          color: #a0c4b4;
          line-height: 1.5;
          margin: 0 0 10px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ngp-contact-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .ngp-contact-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: rgba(78,160,120,0.1);
          border: 1px solid rgba(78,160,120,0.2);
          border-radius: 20px;
          font-size: 12px;
          color: #7ec9a6;
          text-decoration: none;
          transition: background 0.15s;
        }
        .ngp-contact-chip:hover { background: rgba(78,160,120,0.18); }
        .ngp-lang-row {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #6b8f80;
          font-size: 12px;
          flex-wrap: wrap;
        }
        .ngp-lang-chip {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 2px 8px;
          font-size: 11px;
          color: #8ba99e;
        }
        .ngp-guide-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 24px 8px;
        }
        .ngp-guide-chip {
          border: 1px solid rgba(78,160,120,0.25);
          background: rgba(78,160,120,0.08);
          color: #8dbbaa;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        .ngp-guide-chip.active {
          background: rgba(45,138,94,0.35);
          color: #d8f5e8;
          border-color: rgba(78,160,120,0.55);
        }
        .ngp-info-banner {
          margin: 0 24px 18px;
          padding: 12px 16px;
          background: rgba(78,160,120,0.08);
          border: 1px solid rgba(78,160,120,0.18);
          border-radius: 12px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 13px;
          color: #8dbbaa;
          line-height: 1.5;
        }
        .ngp-info-banner svg { color: #4ead7e; flex-shrink: 0; margin-top: 1px; }
        .ngp-info-banner strong { color: #a8d4bc; }

        .ngp-error {
          margin: 0 24px 12px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 10px;
          color: #fca5a5;
          font-size: 13px;
        }
        .ngp-connect-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin: 0 24px 24px;
          width: calc(100% - 48px);
          padding: 14px 20px;
          background: linear-gradient(135deg, #2d8a5e, #1d6044);
          border: none;
          border-radius: 12px;
          color: #c8f0de;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .ngp-connect-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .ngp-connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .ngp-spinner { animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .ngp-connected-msg {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 24px 24px;
          padding: 14px 18px;
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.25);
          border-radius: 12px;
          color: #86efac;
          font-size: 14px;
        }
        .ngp-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 40px 24px 28px;
          color: #6b8f80;
          text-align: center;
          font-size: 14px;
        }
        .ngp-empty-icon { color: #2d5a4e; }
        .ngp-empty-sub { font-size: 12px; color: #4a6b5e; }
        .ngp-btn-secondary {
          margin-top: 10px;
          padding: 10px 24px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: #8ba99e;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .ngp-btn-secondary:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
