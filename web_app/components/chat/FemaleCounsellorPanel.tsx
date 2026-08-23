"use client";

import React, { useEffect, useState } from "react";
import { X, Phone, Mail, Star, MapPin, CheckCircle2, Loader2, Heart, Lightbulb } from "lucide-react";

interface FemaleNyayGuideProfile {
  uid: string;
  name: string;
  location: string;
  bio: string;
  avatar: string;
  contact_number: string;
  email: string;
  availability: string;
  rating: number;
  sessions_completed: number;
  languages: string[];
  specialization?: string[];
  qualification?: string;
  experience_years?: number;
  consultation_fee?: number;
}

interface Props {
  profiles: FemaleNyayGuideProfile[];
  caseId: string | null;
  userId: string;
  onConnect: (profile: FemaleNyayGuideProfile) => void;
  onClose: () => void;
}

const FALLBACK_AVATAR = "https://ui-avatars.com/api/?name=Female+NyayGuide&background=16a085&color=fff&size=128";

export function FemaleNyayGuidePanel({ profiles, caseId, userId, onConnect, onClose }: Props) {
  const nyayguide = profiles[0] || null;
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string>(nyayguide?.avatar || FALLBACK_AVATAR);

  useEffect(() => {
    setImgSrc(nyayguide?.avatar || FALLBACK_AVATAR);
  }, [nyayguide?.avatar]);

  const handleConnect = async () => {
    if (!nyayguide) return;
    setLoading(true);
    setError(null);
    try {
      if (caseId) {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        let res = await fetch(`${baseUrl}/api/cases/${caseId}/assign-female-nyayguide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nyayguide_uid: nyayguide.uid,
            nyayguide_name: nyayguide.name,
            user_id: userId,
            specialization: nyayguide.specialization || ["Sexual Trauma Support"],
          }),
        });

        // Backward-compatible fallback for old API route and payload schema.
        if (!res.ok) {
          res = await fetch(`${baseUrl}/api/cases/${caseId}/assign-counsellor`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              counsellor_uid: nyayguide.uid,
              counsellor_name: nyayguide.name,
              user_id: userId,
              specialization: nyayguide.specialization || ["Sexual Trauma Support"],
            }),
          });
        }

        if (!res.ok) throw new Error("Failed to connect to Female NyayGuide");
      }
      setConnected(true);
      onConnect(nyayguide);
    } catch (e: any) {
      setError(e?.message || "Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="female-counsellor-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="female-counsellor-modal">
        {/* Header */}
        <div className="fc-header">
          <div className="fc-header-icon">
            <Heart size={22} />
          </div>
          <div>
            <h2 className="fc-title">Female NyayGuide</h2>
            <p className="fc-subtitle">Mental Health & Trauma Support</p>
          </div>
          <button className="fc-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* No profiles state */}
        {!nyayguide ? (
          <div className="fc-empty">
            <Heart size={42} className="fc-empty-icon" />
            <p>No female NyayGuide available in your area right now.</p>
            <p className="fc-empty-sub">Our support team can help connect you with mental health resources. Please reach out.</p>
            <button className="fc-btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* NyayGuide Card */}
            <div className="fc-counsellor-card">
              <div className="fc-counsellor-avatar-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={nyayguide.name}
                  width={88}
                  height={88}
                  className="fc-counsellor-avatar"
                  onError={() => setImgSrc(FALLBACK_AVATAR)}
                />
                <span className={`fc-availability-dot ${nyayguide.availability === "Available" ? "available" : "busy"}`} />
              </div>

              <div className="fc-counsellor-info">
                <h3 className="fc-counsellor-name">{nyayguide.name}</h3>
                {nyayguide.qualification && (
                  <p className="fc-counsellor-qualification">{nyayguide.qualification}</p>
                )}

                <div className="fc-counsellor-meta">
                  <span className="fc-meta-item">
                    <MapPin size={13} /> {nyayguide.location}
                  </span>
                  {nyayguide.rating > 0 && (
                    <span className="fc-meta-item">
                      <Star size={13} className="fc-star" /> {nyayguide.rating.toFixed(1)}
                    </span>
                  )}
                  {nyayguide.sessions_completed > 0 && (
                    <span className="fc-meta-item">
                      <Lightbulb size={13} /> {nyayguide.sessions_completed} sessions
                    </span>
                  )}
                </div>

                {nyayguide.experience_years && (
                  <p className="fc-experience">
                    <strong>{nyayguide.experience_years} years</strong> of guidance experience
                  </p>
                )}

                {nyayguide.bio && <p className="fc-counsellor-bio">{nyayguide.bio}</p>}

                {nyayguide.specialization && nyayguide.specialization.length > 0 && (
                  <div className="fc-specialization">
                    <strong>Areas of Support:</strong>
                    <div className="fc-spec-tags">
                      {nyayguide.specialization.slice(0, 3).map((spec, idx) => (
                        <span key={idx} className="fc-spec-tag">{spec}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="fc-contact-row">
                  {nyayguide.contact_number && (
                    <a href={`tel:${nyayguide.contact_number}`} className="fc-contact-chip">
                      <Phone size={14} /> {nyayguide.contact_number}
                    </a>
                  )}
                  {nyayguide.email && (
                    <a href={`mailto:${nyayguide.email}`} className="fc-contact-chip">
                      <Mail size={14} /> Email
                    </a>
                  )}
                </div>

                {nyayguide.languages && nyayguide.languages.length > 0 && (
                  <div className="fc-languages">
                    <span className="fc-lang-label">Languages:</span>
                    {nyayguide.languages.map((lang, idx) => (
                      <span key={idx} className="fc-lang-chip">{lang}</span>
                    ))}
                  </div>
                )}

                {nyayguide.consultation_fee && (
                  <p className="fc-fee">
                    Session Fee: <strong>₹{nyayguide.consultation_fee.toLocaleString()}</strong>
                  </p>
                )}
              </div>
            </div>

            {/* Info banner */}
            <div className="fc-info-banner">
              <Heart size={15} />
              <span>
                Providing <strong>confidential, compassionate support</strong> for trauma recovery and emotional healing.
                All sessions are <strong>trauma-informed and judgment-free</strong>.
              </span>
            </div>

            {/* Error */}
            {error && <p className="fc-error">{error}</p>}

            {/* CTA */}
            {connected ? (
              <div className="fc-connected-msg">
                <CheckCircle2 size={20} />
                <span><strong>{nyayguide.name}</strong> will start your support journey.</span>
              </div>
            ) : (
              <button
                className="fc-connect-btn"
                onClick={handleConnect}
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 size={18} className="fc-spinner" /> Connecting…</>
                ) : (
                  <><Heart size={18} /> Connect with Female NyayGuide</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      <style>{`
        .female-counsellor-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: fcFadeIn 0.2s ease;
        }
        @keyframes fcFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .female-counsellor-modal {
          background: linear-gradient(145deg, #0f2420, #0a1814);
          border: 1px solid rgba(22, 160, 133, 0.25);
          border-radius: 20px;
          padding: 0;
          width: min(520px, 95vw);
          max-height: 92vh;
          overflow-y: auto;
          box-shadow: 0 28px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(22,160,133,0.1);
          animation: fcSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes fcSlideUp {
          from { transform: translateY(30px) scale(0.96); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        .fc-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .fc-header-icon {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: linear-gradient(135deg, #16a085, #0d7c5c);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #6dd8c0;
          flex-shrink: 0;
        }
        .fc-title {
          font-size: 16px;
          font-weight: 700;
          color: #d4f5eb;
          margin: 0;
          line-height: 1.2;
        }
        .fc-subtitle {
          font-size: 12px;
          color: #5bbaa0;
          margin: 2px 0 0;
        }
        .fc-close-btn {
          margin-left: auto;
          background: rgba(255,255,255,0.06);
          border: none;
          color: #7da199;
          border-radius: 8px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .fc-close-btn:hover { background: rgba(255,255,255,0.12); color: #c4ede4; }

        .fc-counsellor-card {
          display: flex;
          gap: 20px;
          padding: 22px 24px;
          align-items: flex-start;
        }
        .fc-counsellor-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .fc-counsellor-avatar {
          width: 88px;
          height: 88px;
          border-radius: 14px;
          object-fit: cover;
          border: 2px solid rgba(22, 160, 133, 0.3);
        }
        .fc-availability-dot {
          position: absolute;
          bottom: 5px;
          right: 5px;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          border: 2px solid #0f2420;
        }
        .fc-availability-dot.available { background: #4ade80; }
        .fc-availability-dot.busy      { background: #f59e0b; }

        .fc-counsellor-info { flex: 1; min-width: 0; }
        .fc-counsellor-name {
          font-size: 17px;
          font-weight: 700;
          color: #d4f5eb;
          margin: 0 0 3px;
        }
        .fc-counsellor-qualification {
          font-size: 13px;
          color: #5bbaa0;
          margin: 0 0 10px;
        }
        .fc-counsellor-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 10px;
        }
        .fc-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #8db5aa;
        }
        .fc-star { color: #f59e0b; }
        .fc-experience {
          font-size: 13px;
          color: #5bbaa0;
          margin: 0 0 8px;
        }
        .fc-counsellor-bio {
          font-size: 13px;
          color: #9dd3c8;
          line-height: 1.5;
          margin: 0 0 10px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fc-specialization {
          margin-bottom: 10px;
        }
        .fc-specialization strong {
          font-size: 12px;
          color: #8db5aa;
          display: block;
          margin-bottom: 5px;
        }
        .fc-spec-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .fc-spec-tag {
          display: inline-block;
          padding: 3px 10px;
          background: rgba(22, 160, 133, 0.15);
          border: 1px solid rgba(22, 160, 133, 0.25);
          border-radius: 12px;
          font-size: 11px;
          color: #7dd4c4;
        }
        .fc-contact-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .fc-contact-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: rgba(22, 160, 133, 0.1);
          border: 1px solid rgba(22, 160, 133, 0.2);
          border-radius: 20px;
          font-size: 12px;
          color: #5fc4b2;
          text-decoration: none;
          transition: background 0.15s;
        }
        .fc-contact-chip:hover { background: rgba(22, 160, 133, 0.18); }
        .fc-languages {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          flex-wrap: wrap;
          font-size: 12px;
        }
        .fc-lang-label {
          color: #8db5aa;
          font-weight: 600;
        }
        .fc-lang-chip {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 2px 8px;
          font-size: 11px;
          color: #8db5aa;
        }
        .fc-fee {
          font-size: 12px;
          color: #5bbaa0;
          margin: 8px 0 0;
        }
        .fc-info-banner {
          margin: 0 24px 18px;
          padding: 12px 16px;
          background: rgba(22, 160, 133, 0.08);
          border: 1px solid rgba(22, 160, 133, 0.18);
          border-radius: 12px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 13px;
          color: #7db9ae;
          line-height: 1.5;
        }
        .fc-info-banner svg { color: #4abca0; flex-shrink: 0; margin-top: 1px; }
        .fc-info-banner strong { color: #6dd8c0; }

        .fc-error {
          margin: 0 24px 12px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 10px;
          color: #fca5a5;
          font-size: 13px;
        }
        .fc-connect-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin: 0 24px 24px;
          width: calc(100% - 48px);
          padding: 14px 20px;
          background: linear-gradient(135deg, #16a085, #0d7c5c);
          border: none;
          border-radius: 12px;
          color: #b0f0e0;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .fc-connect-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .fc-connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .fc-spinner { animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .fc-connected-msg {
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
        .fc-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 40px 24px 28px;
          color: #6b8e85;
          text-align: center;
          font-size: 14px;
        }
        .fc-empty-icon { color: #2d5a50; }
        .fc-empty-sub { font-size: 12px; color: #4a6b5f; }
        .fc-btn-secondary {
          margin-top: 10px;
          padding: 10px 24px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: #8db5aa;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .fc-btn-secondary:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}

export const FemaleCounsellorPanel = FemaleNyayGuidePanel;
