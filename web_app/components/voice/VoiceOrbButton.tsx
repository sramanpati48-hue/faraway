import React from "react";
import { motion } from "framer-motion";

export type VoiceOrbState = "idle" | "listening" | "processing" | "speaking" | "error";

export function VoiceOrbButton({
  state,
  onPressStart,
  onPressEnd,
}: {
  state: VoiceOrbState;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  const NUM_RINGS = 8;
  
  const variants = {
    idle: { 
      borderRadius: "50px", 
      width: 40, 
      height: 80, 
      rotate: 0,
      transition: { type: "spring", stiffness: 120, damping: 20 }
    },
    listening: { 
      borderRadius: "50%", 
      width: 80, 
      height: 80, 
      rotate: 0, 
      scale: [1, 1.05, 1], 
      transition: { 
        scale: { repeat: Infinity, duration: 2, ease: "easeInOut" },
        borderRadius: { type: "spring", stiffness: 120, damping: 20 },
        width: { type: "spring", stiffness: 120, damping: 20 },
        height: { type: "spring", stiffness: 120, damping: 20 }
      } 
    },
    processing: { 
      borderRadius: "50%", 
      width: 80, 
      height: 80, 
      rotate: 180,
      transition: { type: "spring", stiffness: 120, damping: 20 }
    },
    speaking: { 
      borderRadius: "24px", 
      width: 80, 
      height: 80, 
      rotate: 0, 
      scale: [1, 1.1, 1], 
      transition: { 
        scale: { repeat: Infinity, duration: 1, ease: "easeInOut" },
        borderRadius: { type: "spring", stiffness: 120, damping: 20 },
        width: { type: "spring", stiffness: 120, damping: 20 },
        height: { type: "spring", stiffness: 120, damping: 20 }
      } 
    },
    error: { 
      borderRadius: "8px", 
      width: 80, 
      height: 80, 
      rotate: 45,
      transition: { type: "spring", stiffness: 120, damping: 20 }
    }
  };

  return (
    <div 
      className="relative flex justify-center items-center h-64 w-64 cursor-pointer touch-none"
      onMouseDown={onPressStart}
      onMouseUp={onPressEnd}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
      onMouseLeave={onPressEnd} // stop recording if cursor leaves the button while pressed
    >
      {[...Array(NUM_RINGS)].map((_, index) => {
        const isCore = index === 0;
        const scaleMultiplier = 1 + index * 0.25;
        const opacity = isCore ? 1 : Math.max(0.6 - index * 0.08, 0.05);
        
        return (
          <motion.div
            key={index}
            variants={variants}
            initial="idle"
            animate={state}
            custom={index} // Used for staggered delays if needed
            transition={
              state === "processing" 
                ? { type: "spring", stiffness: 120, damping: 20, delay: index * 0.05 } 
                : undefined // Fall back to variant transition
            }
            className="absolute origin-center"
            style={{
              background: isCore ? "linear-gradient(135deg, #4ADE80, #16A34A)" : "transparent",
              border: isCore ? "none" : `2px solid rgba(34, 197, 94, ${opacity})`,
              boxShadow: isCore ? "0 0 20px rgba(34, 197, 94, 0.4)" : "none",
              scale: scaleMultiplier,
            }}
          />
        );
      })}
      
      {/* Orbital Dot in Idle state */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
        className="absolute w-[100px] h-[100px] pointer-events-none"
      >
        <motion.div 
          animate={state === "idle" ? { opacity: 1 } : { opacity: 0 }}
          className="absolute bottom-0 left-1/2 -ml-[4px] w-2 h-2 rounded-full bg-[#16A34A]"
        />
      </motion.div>
    </div>
  );
}
