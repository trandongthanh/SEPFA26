import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface RegisterDraft {
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
}

interface AgreementState {
  termsAgreed: boolean;
  privacyAgreed: boolean;
  registerDraft: RegisterDraft | null;
  setTermsAgreed: (agreed: boolean) => void;
  setPrivacyAgreed: (agreed: boolean) => void;
  setBothAgreed: (agreed: boolean) => void;
  setRegisterDraft: (draft: RegisterDraft | null) => void;
  resetAgreements: () => void;
}

export const useAgreementStore = create<AgreementState>()(
  persist(
    (set) => ({
      termsAgreed: false,
      privacyAgreed: false,
      registerDraft: null,

      setTermsAgreed: (agreed: boolean) => set({ termsAgreed: agreed }),
      setPrivacyAgreed: (agreed: boolean) => set({ privacyAgreed: agreed }),
      setBothAgreed: (agreed: boolean) =>
        set({ termsAgreed: agreed, privacyAgreed: agreed }),
      setRegisterDraft: (draft: RegisterDraft | null) => set({ registerDraft: draft }),
      resetAgreements: () =>
        set({
          termsAgreed: false,
          privacyAgreed: false,
          registerDraft: null,
        }),
    }),
    {
      name: 'lancare-agreements',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
