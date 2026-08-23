"use client";

import React, { useState } from "react";
import { AlertCircle, Heart, Scale, User, MessageSquare, Navigation } from "lucide-react";

interface SexualOffenseScreeningProps {
  onSubmit: (answers: {
    immediate_danger: boolean;
    minor_involved: boolean;
    female_lawyer_preferred: boolean;
    female_nyayguide_needed: boolean;
    contact_preference: "chat" | "call";
  }) => void;
  onClose: () => void;
}

export function SexualOffenseScreening({ onSubmit, onClose }: SexualOffenseScreeningProps) {
  const [immediageDanger, setImmediateDanger] = useState<boolean | null>(null);
  const [minorInvolved, setMinorInvolved] = useState<boolean | null>(null);
  const [femaleLawyerPreferred, setFemaleLawyerPreferred] = useState<boolean | null>(null);
  const [femaleNyayGuideNeeded, setFemaleNyayGuideNeeded] = useState<boolean | null>(null);
  const [contactPreference, setContactPreference] = useState<"chat" | "call">("chat");

  const allAnswered = 
    immediageDanger !== null && 
    minorInvolved !== null && 
    femaleLawyerPreferred !== null && 
    femaleNyayGuideNeeded !== null;

  const handleSubmit = () => {
    if (!allAnswered) return;
    
    onSubmit({
      immediate_danger: immediageDanger!,
      minor_involved: minorInvolved!,
      female_lawyer_preferred: femaleLawyerPreferred!,
      female_nyayguide_needed: femaleNyayGuideNeeded!,
      contact_preference: contactPreference,
    });
  };

  return (
    <div className="sos-overlay" onClick={onClose}>
      <div className="sos-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sos-header">
          <AlertCircle size={28} className="sos-icon-alert" />
          <h2>We're Here to Help</h2>
          <p>You don't need to share full details right now. We can first connect you with support.</p>
        </div>

        <div className="sos-content">
          {/* Critical Safety Question */}
          <div className="sos-section">
            <div className="sos-question-label">
              <AlertCircle size={18} />
              <span>Are you in immediate danger right now?</span>
            </div>
            <div className="sos-button-group">
              <button
                className={`sos-choice ${immediageDanger === true ? "selected danger" : ""}`}
                onClick={() => setImmediateDanger(true)}
              >
                Yes, Emergency
              </button>
              <button
                className={`sos-choice ${immediageDanger === false ? "selected" : ""}`}
                onClick={() => setImmediateDanger(false)}
              >
                No, I'm Safe
              </button>
            </div>
            {immediageDanger === true && (
              <div className="sos-emergency-info">
                <strong>🚨 Emergency Number: 100 (Police) | 1091 (Women's Helpline)</strong>
                <p>Contact authorities immediately if you're in danger. We're also here to help with legal support.</p>
              </div>
            )}
          </div>

          {/* Minor Question */}
          <div className="sos-section">
            <div className="sos-question-label">
              <User size={18} />
              <span>Is the survivor a minor (under 18)?</span>
            </div>
            <div className="sos-button-group">
              <button
                className={`sos-choice ${minorInvolved === true ? "selected" : ""}`}
                onClick={() => setMinorInvolved(true)}
              >
                Yes, Minor
              </button>
              <button
                className={`sos-choice ${minorInvolved === false ? "selected" : ""}`}
                onClick={() => setMinorInvolved(false)}
              >
                No, Adult
              </button>
            </div>
          </div>

          {/* Female Lawyer Preference */}
          <div className="sos-section">
            <div className="sos-question-label">
              <Scale size={18} />
              <span>Do you prefer a female lawyer?</span>
            </div>
            <div className="sos-button-group">
              <button
                className={`sos-choice ${femaleLawyerPreferred === true ? "selected" : ""}`}
                onClick={() => setFemaleLawyerPreferred(true)}
              >
                Yes, Female Lawyer
              </button>
              <button
                className={`sos-choice ${femaleLawyerPreferred === false ? "selected" : ""}`}
                onClick={() => setFemaleLawyerPreferred(false)}
              >
                Any Experienced Lawyer
              </button>
            </div>
          </div>

          {/* Female NyayGuide Support */}
          <div className="sos-section">
            <div className="sos-question-label">
              <Heart size={18} />
              <span>Do you want support from a Female NyayGuide?</span>
            </div>
            <div className="sos-button-group">
              <button
                className={`sos-choice ${femaleNyayGuideNeeded === true ? "selected" : ""}`}
                onClick={() => setFemaleNyayGuideNeeded(true)}
              >
                Yes, Connect Female NyayGuide
              </button>
              <button
                className={`sos-choice ${femaleNyayGuideNeeded === false ? "selected" : ""}`}
                onClick={() => setFemaleNyayGuideNeeded(false)}
              >
                Legal Help Only
              </button>
            </div>
          </div>

          {/* Contact Preference */}
          {allAnswered && (
            <div className="sos-section">
              <div className="sos-question-label">
                <Navigation size={18} />
                <span>How would you like to be contacted?</span>
              </div>
              <div className="sos-button-group">
                <button
                  className={`sos-choice ${contactPreference === "chat" ? "selected" : ""}`}
                  onClick={() => setContactPreference("chat")}
                >
                  <MessageSquare size={16} /> Chat / Text
                </button>
                <button
                  className={`sos-choice ${contactPreference === "call" ? "selected" : ""}`}
                  onClick={() => setContactPreference("call")}
                >
                  Phone Call
                </button>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="sos-disclaimer">
            <strong>Privacy & Safety:</strong> All conversations are confidential and trauma-informed. 
            You have full control over what information you share.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sos-footer">
          <button className="sos-btn-close" onClick={onClose}>
            Close
          </button>
          <button 
            className={`sos-btn-submit ${allAnswered ? "" : "disabled"}`}
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            Continue & Connect
          </button>
        </div>
      </div>

      <style>{`
        .sos-overlay {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }

        .sos-modal {
          background: linear-gradient(145deg, #1a1a2e, #0f3460);
          border: 1px solid rgba(233, 69, 96, 0.25);
          border-radius: 16px;
          width: min(600px, 95vw);
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1);
          animation: sosSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes sosSlideUp {
          from { transform: translateY(40px) scale(0.95); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }

        .sos-header {
          background: linear-gradient(135deg, rgba(233, 69, 96, 0.15), rgba(255, 107, 107, 0.1));
          border-bottom: 1px solid rgba(233, 69, 96, 0.2);
          padding: 28px 24px;
          text-align: center;
        }

        .sos-icon-alert {
          color: #e94560;
          margin-bottom: 12px;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .sos-header h2 {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 8px;
        }

        .sos-header p {
          font-size: 14px;
          color: #b0a8ac;
          margin: 0;
          line-height: 1.6;
        }

        .sos-content {
          padding: 24px;
        }

        .sos-section {
          margin-bottom: 24px;
        }

        .sos-section:last-of-type {
          margin-bottom: 16px;
        }

        .sos-question-label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 15px;
          font-weight: 600;
          color: #e8d5dc;
          margin-bottom: 12px;
        }

        .sos-question-label svg {
          color: #e94560;
          flex-shrink: 0;
        }

        .sos-button-group {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .sos-choice {
          flex: 1;
          min-width: 120px;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          color: #b0a8ac;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .sos-choice:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
          color: #d9d0d5;
        }

        .sos-choice.selected {
          background: rgba(233, 69, 96, 0.2);
          border-color: rgba(233, 69, 96, 0.4);
          color: #ff9aaa;
        }

        .sos-choice.selected.danger {
          background: rgba(239, 68, 68, 0.25);
          border-color: rgba(239, 68, 68, 0.5);
          color: #fca5a5;
        }

        .sos-emergency-info {
          margin-top: 12px;
          padding: 12px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 8px;
          font-size: 12px;
          color: #fca5a5;
          line-height: 1.6;
        }

        .sos-emergency-info strong {
          color: #ff6b6b;
          display: block;
          margin-bottom: 6px;
        }

        .sos-disclaimer {
          margin-top: 16px;
          padding: 12px 14px;
          background: rgba(100, 200, 200, 0.08);
          border: 1px solid rgba(100, 200, 200, 0.15);
          border-radius: 8px;
          font-size: 12px;
          color: #8dd8d0;
          line-height: 1.6;
        }

        .sos-disclaimer strong {
          display: block;
          color: #5ec4b0;
          margin-bottom: 4px;
        }

        .sos-footer {
          display: flex;
          gap: 12px;
          padding: 16px 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(0, 0, 0, 0.2);
        }

        .sos-btn-close {
          flex: 1;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #b0a8ac;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .sos-btn-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #d9d0d5;
        }

        .sos-btn-submit {
          flex: 1;
          padding: 12px 16px;
          background: linear-gradient(135deg, #e94560, #c9374a);
          border: none;
          border-radius: 8px;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .sos-btn-submit:hover:not(.disabled) {
          background: linear-gradient(135deg, #ff5a76, #e94560);
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(233, 69, 96, 0.3);
        }

        .sos-btn-submit.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Scrollbar styling */
        .sos-modal::-webkit-scrollbar {
          width: 6px;
        }

        .sos-modal::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }

        .sos-modal::-webkit-scrollbar-thumb {
          background: rgba(233, 69, 96, 0.3);
          border-radius: 3px;
        }

        .sos-modal::-webkit-scrollbar-thumb:hover {
          background: rgba(233, 69, 96, 0.5);
        }
      `}</style>
    </div>
  );
}
