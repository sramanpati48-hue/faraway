"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { HUMAN_LADDER } from "@/components/landing/landing-data";
import { dmSans } from "@/lib/fonts";
import { cn } from "@/lib/utils";

type HumanLadderItem = (typeof HUMAN_LADDER)[number];

function columnDividerClass(index: number): string {
  return cn(
    index > 0 && "border-t border-slate-200/80 sm:border-t-0",
    index % 2 === 1 && "sm:border-l border-slate-200/80",
    index >= 2 && "sm:border-t border-slate-200/80 lg:border-t-0",
    index > 0 && "lg:border-l"
  );
}

function HumanHelpColumn({
  item,
  index,
  reduceMotion,
}: {
  item: HumanLadderItem;
  index: number;
  reduceMotion: boolean;
}) {
  const figure = String(index + 1).padStart(2, "0");

  return (
    <motion.li
      className={cn(
        dmSans.className,
        "flex min-h-[22rem] min-w-0 flex-col px-6 py-10 sm:min-h-[24rem] sm:px-7 lg:min-h-[26rem] lg:px-8 lg:py-12",
        columnDividerClass(index)
      )}
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, delay: reduceMotion ? 0 : index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400">{figure}</p>

      <div className="relative mx-auto mt-8 w-full max-w-[9.5rem] flex-1 sm:max-w-[10.5rem] lg:max-w-[11rem]">
        <div className="relative aspect-square w-full">
          <Image
            src={item.image}
            alt={item.imageAlt}
            fill
            className="object-contain object-center opacity-[0.92] contrast-[1.02]"
            sizes="(max-width: 1024px) 40vw, 176px"
          />
        </div>
      </div>

      <div className="mt-auto pt-10">
        <h3 className="text-base font-semibold leading-snug text-slate-900">{item.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.detail}</p>
      </div>
    </motion.li>
  );
}

export function HumanHelpColumns({ items }: { items: HumanLadderItem[] }) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <ol className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => (
        <HumanHelpColumn key={item.title} item={item} index={index} reduceMotion={reduceMotion} />
      ))}
    </ol>
  );
}
