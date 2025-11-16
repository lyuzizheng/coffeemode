import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { extractPlaceTitleFromUrl } from "@/services/googleMaps";
import { ResolvePlaceResponseDto } from "@/types/googleMaps";
import { useResolvePlace } from "@/hooks/googleMaps/useResolvePlace";
import { useLinkPreview } from "@/hooks/useLinkPreview";

interface CreateCafeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateCafeModal = ({ open, onOpenChange }: CreateCafeModalProps) => {
  const [gmapsUrl, setGmapsUrl] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const { resolvePlace } = useResolvePlace();
  const { data: previewData, loading: previewLoading } = useLinkPreview(gmapsUrl.trim() || null);

  // Resolve Google Maps link into backend Cafe using the /resolve API.
  const resolveMutation = useMutation({
    mutationFn: async (url: string) => {
      // 1. Use preview metadata if available, otherwise fall back to title extraction
      const titleFromUrl = extractPlaceTitleFromUrl(url);
      const title = previewData?.metadata.title || titleFromUrl || "";
      const description = previewData?.metadata.description || "";
      // 2. Call backend resolve
      const res = await resolvePlace({ title, description, url });
      return res;
    },
    onSuccess: (res) => {
      const data = res.data as ResolvePlaceResponseDto | null;
      if (!data) {
        setStatusMessage("解析成功，但返回数据为空");
        return;
      }
      setStatusMessage(
        data.skippedDetails
          ? `已存在，跳过详情抓取：${data.cafe.name}`
          : `解析并创建成功：${data.cafe.name}`
      );
      // Close modal shortly after success
      setTimeout(() => onOpenChange(false), 1200);
    },
    onError: (err: unknown) => {
      setStatusMessage("解析失败，请检查链接或稍后重试");
      console.error(err);
    },
  });

  const handleResolveClick = () => {
    if (!gmapsUrl.trim()) {
      setStatusMessage("请粘贴 Google 地图链接");
      return;
    }
    setStatusMessage("");
    resolveMutation.mutate(gmapsUrl.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建咖啡店</DialogTitle>
          <DialogDescription>仅支持通过 Google 地图链接解析创建</DialogDescription>
        </DialogHeader>

        <div className={cn("grid grid-cols-1 gap-6")}> 
          {/* 粘贴 Google 地图链接并解析 */}
          <Card className="p-4" aria-label="从链接解析创建">
            <h3 className="text-lg font-medium">粘贴 Google 地图链接</h3>
            <p className="text-sm text-muted-foreground mb-3">支持 maps.google.com 或 maps.app.goo.gl</p>
            <Input
              value={gmapsUrl}
              onChange={(e) => setGmapsUrl(e.target.value)}
              placeholder="粘贴链接，例如 https://maps.app.goo.gl/..."
              aria-label="Google 地图链接输入框"
            />

            {/* 预览区：展示解析到的标题/站点信息 */}
            {previewLoading && (
              <div className="mt-3 text-sm text-muted-foreground">预览加载中...</div>
            )}
            {previewData && (
              <div className="mt-3 text-sm">
                <div className="font-medium">{previewData.metadata.title ?? "Google 地图"}</div>
                <div className="text-muted-foreground">{previewData.metadata.siteName ?? ""}</div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <Button
                onClick={handleResolveClick}
                aria-label="解析并创建"
                className="bg-coffee-600 hover:bg-coffee-700 text-white"
              >
                解析并创建
              </Button>
              {resolveMutation.isPending && (
                <span className="text-sm text-muted-foreground">解析中...</span>
              )}
            </div>
          </Card>
        </div>

        {/* 状态提示 */}
        {statusMessage && (
          <div className="mt-4 text-sm text-primary" aria-live="polite">
            {statusMessage}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateCafeModal;