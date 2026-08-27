"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

// 客席：「シルエット群衆」素材（複数人がまとまった1枚絵）を横幅いっぱいに敷いて
// 観客の帯を表現する。以前は単体シルエットを5人×2段ループする実装だったが、
// 新素材は既に群衆1枚絵のため、繰り返し配置は不要（小さく潰れて見えなくなるため廃止）。
// 呼び出し側でキャラ列ゾーンの直下・操作ゾーンの直前という通常のflow内に置くことで、
// ボタンとは確実に重ならない配置にしている。
export default function AudienceSilhouetteRowPreview() {
  return (
    <div className="relative h-12 w-full overflow-hidden opacity-90 sm:h-16">
      <Image
        src={`${BASE_PATH}/images/live/audience-silhouette.png`}
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "50% 53%", filter: "brightness(2.4) contrast(1.15)" }}
      />
    </div>
  );
}
