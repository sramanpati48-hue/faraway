"use client";

import React, { useEffect, useState } from "react";
import { X, Phone, Mail, Star, MapPin, CheckCircle2, Loader2, Briefcase, Award } from "lucide-react";

interface FemaleLawyerProfile {
  uid: string;
  name: string;
  location: string;
  occupation?: string;
  bio: string;
  avatar: string;
  contact_number: string;
  email: string;
  availability: string;
  rating: number;
  cases_resolved: number;
  languages: string[];
  specialization?: string[];
  bar_registration?: string;
  experience_years?: number;
  consultation_fee?: number;
}

interface Props {
  profiles: FemaleLawyerProfile[];
  caseId: string | null;
  userId: string;
  onConnect: (profile: FemaleLawyerProfile) => void;
  onClose: () => void;
}

const FALLBACK_AVATAR = "https://ui-avatars.com/api/?name=Female+Lawyer&background=d83e7d&color=fff&size=128";

export function FemaleLawyerPanel({ profiles, caseId, userId, onConnect, onClose }: Props) {
  const lawyer = profiles[0] || null;
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string>(lawyer?.avatar || FALLBACK_AVATAR);

  useEffect(() => {
    setImgSrc(lawyer?.avatar || FALLBACK_AVATAR);
  }, [lawyer?.avatar]);

  const handleConnect = async () => {
    if (!lawyer) return;
    setLoading(true);
    setError(null);
    try {
      if (caseId) {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${baseUrl}/api/cases/${caseId}/assign-lawyer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lawyer_uid: lawyer.uid,
            lawyer_name: lawyer.name,
            user_id: userId,
            is_female_lawyer: true,
            specialization: lawyer.specialization || ["Sexual Offences"],
          }),
        });
        if (!res.ok) throw new Error("Failed to connect to Female Lawyer");
      }
      setConnected(true);
      onConnect(lawyer);
    } catch (e: any) {
      setError(e?.message || "Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="female-lawyer-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="female-lawyer-modal">
        {/* Header */}
        <div className="fl-header">
          <div className="fl-header-icon">
            <Briefcase size={22} />
          </div>
          <div>
            <h2 className="fl-title">Female Criminal Lawyer</h2>
            <p className="fl-subtitle">Specialized in Sexual Offence Cases</p>
          </div>
          <button className="fl-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* No profiles state */}
        {!lawyer ? (
          <div className="fl-empty">
            <Briefcase size={42} className="fl-empty-icon" />
            <p>No female lawyer available in your area right now.</p>
            <p className="fl-empty-sub">Our team is working to expand coverage. You can reach our support team for immediate assistance.</p>
            <button className="fl-btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* Lawyer Card */}
            <div className="fl-lawyer-card">
              <div className="fl-lawyer-avatar-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={lawyer.name}
                  width={88}
                  height={88}
                  className="fl-lawyer-avatar"
                  onError={() => setImgSrc(FALLBACK_AVATAR)}
                />
                <span className={`fl-availability-dot ${lawyer.availability === "Available" ? "available" : "busy"}`} />
              </div>

              <div className="fl-lawyer-info">
                <h3 className="fl-lawyer-name">{lawyer.name}</h3>
                <p className="fl-lawyer-occupation">{lawyer.occupation || "Criminal Lawyer - Sexual Offences"}</p>

                <div className="fl-lawyer-meta">
                  <span className="fl-meta-item">
                    <MapPin size={13} /> {lawyer.location}
                  </span>
                  {lawyer.rating > 0 && (
                    <span className="fl-meta-item">
                      <Star size={13} className="fl-star" /> {lawyer.rating.toFixed(1)}
                    </span>
                  )}
                  {lawyer.cases_resolved > 0 && (
                    <span className="fl-meta-item">
                      <Award size={13} /> {lawyer.cases_resolved} cases
                    </span>
                  )}
                </div>

                {lawyer.experience_years && (
                  <p className="fl-experience">
                    <strong>{lawyer.experience_years} years</strong> of specialized experience
                  </p>
                )}

                {lawyer.bio && <p className="fl-lawyer-bio">{lawyer.bio}</p>}

                {lawyer.specialization && lawyer.specialization.length > 0 && (
                  <div className="fl-specialization">
                    <strong>Specialization:</strong>
                    <div className="fl-spec-tags">
                      {lawyer.specialization.slice(0, 3).map((spec, idx) => (
                        <span key={idx} className="fl-spec-tag">{spec}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="fl-contact-row">
                  {lawyer.contact_number && (
                    <a href={`tel:${lawyer.contact_number}`} className="fl-contact-chip">
                      <Phone size={14} /> {lawyer.contact_number}
                    </a>
                  )}
                  {lawyer.email && (
                    <a href={`mailto:${lawyer.email}`} className="fl-contact-chip">
                      <Mail size={14} /> Email
                    </a>
                  )}
                </div>

                {lawyer.languages && lawyer.languages.length > 0 && (
                  <div className="fl-languages">
                    <span className="fl-lang-label">Languages:</span>
                    {lawyer.languages.map((lang, idx) => (
                      <span key={idx} className="fl-lang-chip">{lang}</span>
                    ))}
                  </div>
                )}

                {lawyer.consultation_fee && (
                  <p className="fl-fee">
                    Consultation Fee: <strong>₹{lawyer.consultation_fee.toLocaleString()}</strong>
                  </p>
                )}
              </div>
            </div>

            {/* Info banner */}
            <div className="fl-info-banner">
              <Briefcase size={15} />
              <span>
                Providing <strong>confidential legal representation</strong> for sexual offence and assault cases.
                All consultations are <strong>discreet and trauma-informed</strong>.
              </span>
            </div>

            {/* Error */}
            {error && <p className="fl-error">{error}</p>}

            {/* CTA */}
            {connected ? (
              <div className="fl-connected-msg">
                <CheckCircle2 size={20} />
                <span><strong>{lawyer.name}</strong> will be assigned to your case.</span>
              </div>
            ) : (
              <button
                className="fl-connect-btn"
                onClick={handleConnect}
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 size={18} className="fl-spinner" /> Connecting…</>
                ) : (
                  <><Briefcase size={18} /> Connect with Female Lawyer</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      <style>{`
        .female-lawyer-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: flFadeIn 0.2s ease;
        }
        @keyframes flFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .female-lawyer-modal {
          background: linear-gradient(145deg, #2d1b2e, #1f1025);
          border: 1px solid rgba(216, 62, 125, 0.25);
          border-radius: 20px;
          padding: 0;
          width: min(520px, 95vw);
          max-height: 92vh;
          overflow-y: auto;
          box-shadow: 0 28px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(216,62,125,0.1);
          animation: flSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes flSlideUp {
          from { transform: translateY(30px) scale(0.96); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        .fl-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .fl-header-icon {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: linear-gradient(135deg, #d83e7d, #a82468);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #f5a8d4;
          flex-shrink: 0;
        }
        .fl-title {
          font-size: 16px;
          font-weight: 700;
          color: #f5e6ed;
          margin: 0;
          line-height: 1.2;
        }
        .fl-subtitle {
          font-size: 12px;
          color: #d878a8;
          margin: 2px 0 0;
        }
        .fl-close-btn {
          margin-left: auto;
          background: rgba(255,255,255,0.06);
          border: none;
          color: #b49eaa;
          border-radius: 8px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .fl-close-btn:hover { background: rgba(255,255,255,0.12); color: #e8d9e0; }

        .fl-lawyer-card {
          display: flex;
          gap: 20px;
          padding: 22px 24px;
          align-items: flex-start;
        }
        .fl-lawyer-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .fl-lawyer-avatar {
          width: 88px;
          height: 88px;
          border-radius: 14px;
          object-fit: cover;
          border: 2px solid rgba(216, 62, 125, 0.3);
        }
        .fl-availability-dot {
          position: absolute;
          bottom: 5px;
          right: 5px;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          border: 2px solid #2d1b2e;
        }
        .fl-availability-dot.available { background: #4ade80; }
        .fl-availability-dot.busy      { background: #f59e0b; }

        .fl-lawyer-info { flex: 1; min-width: 0; }
        .fl-lawyer-name {
          font-size: 17px;
          font-weight: 700;
          color: #f5e6ed;
          margin: 0 0 3px;
        }
        .fl-lawyer-occupation {
          font-size: 13px;
          color: #d878a8;
          margin: 0 0 10px;
        }
        .fl-lawyer-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 10px;
        }
        .fl-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #b49eaa;
        }
        .fl-star { color: #f59e0b; }
        .fl-experience {
          font-size: 13px;
          color: #d878a8;
          margin: 0 0 8px;
        }
        .fl-lawyer-bio {
          font-size: 13px;
          color: #c4a5b4;
          line-height: 1.5;
          margin: 0 0 10px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fl-specialization {
          margin-bottom: 10px;
        }
        .fl-specialization strong {
          font-size: 12px;
          color: #b49eaa;
          display: block;
          margin-bottom: 5px;
        }
        .fl-spec-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .fl-spec-tag {
          display: inline-block;
          padding: 3px 10px;
          background: rgba(216, 62, 125, 0.15);
          border: 1px solid rgba(216, 62, 125, 0.25);
          border-radius: 12px;
          font-size: 11px;
          color: #e89ab8;
        }
        .fl-contact-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .fl-contact-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: rgba(216, 62, 125, 0.1);
          border: 1px solid rgba(216, 62, 125, 0.2);
          border-radius: 20px;
          font-size: 12px;
          color: #e88fb5;
          text-decoration: none;
          transition: background 0.15s;
        }
        .fl-contact-chip:hover { background: rgba(216, 62, 125, 0.18); }
        .fl-languages {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          flex-wrap: wrap;
          font-size: 12px;
        }
        .fl-lang-label {
          color: #b49eaa;
          font-weight: 600;
        }
        .fl-lang-chip {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 2px 8px;
          font-size: 11px;
          color: #b49eaa;
        }
        .fl-fee {
          font-size: 12px;
          color: #d878a8;
          margin: 8px 0 0;
        }
        .fl-info-banner {
          margin: 0 24px 18px;
          padding: 12px 16px;
          background: rgba(216, 62, 125, 0.08);
          border: 1px solid rgba(216, 62, 125, 0.18);
          border-radius: 12px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 13px;
          color: #c89aae;
          line-height: 1.5;
        }
        .fl-info-banner svg { color: #e879a8; flex-shrink: 0; margin-top: 1px; }
        .fl-info-banner strong { color: #f5a8d4; }

        .fl-error {
          margin: 0 24px 12px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 10px;
          color: #fca5a5;
          font-size: 13px;
        }
        .fl-connect-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin: 0 24px 24px;
          width: calc(100% - 48px);
          padding: 14px 20px;
          background: linear-gradient(135deg, #d83e7d, #a82468);
          border: none;
          border-radius: 12px;
          color: #ffd0e0;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .fl-connect-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .fl-connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .fl-spinner { animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .fl-connected-msg {
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
        .fl-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 40px 24px 28px;
          color: #8f6b7b;
          text-align: center;
          font-size: 14px;
        }
        .fl-empty-icon { color: #5a3a48; }
        .fl-empty-sub { font-size: 12px; color: #6b5962; }
        .fl-btn-secondary {
          margin-top: 10px;
          padding: 10px 24px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: #b49eaa;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .fl-btn-secondary:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
