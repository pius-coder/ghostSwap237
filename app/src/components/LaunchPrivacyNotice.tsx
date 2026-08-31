import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextureButton } from '@/components/ui/texture-button';
import { LegalDocuments } from '@/components/LegalDocuments';

export function LaunchPrivacyNotice() {
  const [open, setOpen] = useState(() => sessionStorage.getItem('henshin-launch-privacy-shown') !== '1');
  const close = () => { sessionStorage.setItem('henshin-launch-privacy-shown', '1'); setOpen(false); };
  return <Dialog open={open}><DialogContent className="max-h-[92vh] sm:max-w-2xl" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Privacy and responsible-use notice</DialogTitle><DialogDescription>This notice is shown whenever Henshin starts. Review how the software and your data may be used.</DialogDescription></DialogHeader><div className="custom-scrollbar max-h-[60vh] overflow-y-auto rounded-lg border border-border p-4"><LegalDocuments /></div><TextureButton onClick={close}>I have seen this notice</TextureButton></DialogContent></Dialog>;
}
