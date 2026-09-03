import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PlantRecognitionService {
  constructor(private readonly config: ConfigService) {}

  async enrich(photoUrl: string, current: Record<string, unknown> | null) {
    const plantIdKey = this.config.get<string>('PLANT_ID_API_KEY');
    const plantNetKey = this.config.get<string>('PLANTNET_API_KEY');
    if (!plantIdKey && !plantNetKey) return current;
    try {
      const image = await fetch(photoUrl);
      if (!image.ok) return current;
      const bytes = Buffer.from(await image.arrayBuffer());
      const [plantIdResult, plantNetResult] = await Promise.allSettled([
        plantIdKey ? this.plantId(plantIdKey, bytes) : Promise.resolve(null),
        plantNetKey ? this.plantNet(plantNetKey, bytes) : Promise.resolve(null),
      ]);
      const plantId = plantIdResult.status === 'fulfilled' ? plantIdResult.value : null;
      const plantNet = plantNetResult.status === 'fulfilled' ? plantNetResult.value : null;
      if (!plantId && !plantNet) throw new Error('PLANT_RECOGNITION_FAILED');
      return {
        ...(current ?? {}),
        recognition: {
          ...((current?.recognition as Record<string, unknown> | undefined) ?? {}),
          status: plantId && plantNet ? 'COMPLETED' : 'PARTIAL',
          providers: {
            ...(plantId ? { plantId: plantId.recognition } : {}),
            ...(plantNet ? { plantNet: plantNet.recognition } : {}),
          },
        },
        disease: plantId?.disease ?? null,
        valuation: { status: 'NOT_AVAILABLE', note: 'Chưa có model định giá đáng tin cậy; dùng giá trị customer khai báo.' },
      };
    } catch {
      return { ...(current ?? {}), recognition: { ...((current?.recognition as Record<string, unknown> | undefined) ?? {}), status: 'FAILED_RETRYABLE' } };
    }
  }

  private async plantId(key: string, bytes: Buffer) {
    const response = await fetch('https://api.plant.id/v3/identification', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Api-Key': key },
      body: JSON.stringify({ images: [`data:image/jpeg;base64,${bytes.toString('base64')}`], health: 'all', similar_images: false }),
    });
    if (!response.ok) throw new Error('PLANT_ID_FAILED');
    const data = (await response.json()) as any;
    const suggestions = data.result?.classification?.suggestions ?? [];
    return {
      recognition: { bestMatch: suggestions[0]?.name ?? null, confidence: suggestions[0]?.probability ?? null, candidates: suggestions.slice(0, 5).map((x: any) => ({ name: x.name, confidence: x.probability })) },
      disease: { healthy: data.result?.is_healthy ?? null, details: data.result?.disease?.suggestions ?? [] },
    };
  }

  private async plantNet(key: string, bytes: Buffer) {
    const form = new FormData();
    form.append('images', new Blob([bytes], { type: 'image/jpeg' }), 'plant.jpg');
    form.append('organs', 'auto');
    const project = this.config.get<string>('PLANTNET_PROJECT', 'all');
    const response = await fetch(`https://my-api.plantnet.org/v2/identify/${project}?api-key=${encodeURIComponent(key)}`, { method: 'POST', body: form });
    if (!response.ok) throw new Error('PLANTNET_FAILED');
    const data = (await response.json()) as any;
    return { recognition: { bestMatch: data.bestMatch ?? null, confidence: data.results?.[0]?.score ?? null, candidates: (data.results ?? []).slice(0, 5).map((x: any) => ({ name: x.species?.scientificName, confidence: x.score })) }, disease: null };
  }
}
