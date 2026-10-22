'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button, Checkbox, Input, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  SearchOutlined,
  DownloadOutlined,
  PrinterOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';

export interface DocumentSection {
  id: string;
  title: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
  rawText?: string;
}

interface LegalDocumentLayoutProps {
  title: string;
  lastUpdated: string;
  sections: DocumentSection[];
  intro?: React.ReactNode;
  checkboxLabel: string;
  buttonLabel: string;
  initialChecked?: boolean;
  onAgree: () => void;
  onBack: () => void;
  onCheckboxChange?: (checked: boolean) => void;
}

export default function LegalDocumentLayout({
  title,
  lastUpdated,
  sections,
  intro,
  checkboxLabel,
  buttonLabel,
  initialChecked = false,
  onAgree,
  onBack,
  onCheckboxChange,
}: LegalDocumentLayoutProps) {
  const [isChecked, setIsChecked] = useState(initialChecked);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || '');

  // Keep local checked in sync if initialChecked changes
  useEffect(() => {
    setIsChecked(Boolean(initialChecked));
  }, [initialChecked]);

  const handleCheckboxToggle = (checked: boolean) => {
    setIsChecked(checked);
    onCheckboxChange?.(checked);
  };

  // Filter sections by search query
  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sections;
    return sections.filter(
      (sec) =>
        sec.title.toLowerCase().includes(query) ||
        (sec.rawText && sec.rawText.toLowerCase().includes(query))
    );
  }, [sections, searchQuery]);

  // Smooth scroll to section
  const scrollToSection = (id: string) => {
    setActiveSectionId(id);
    const element = document.getElementById(id);
    if (element) {
      const yOffset = -90;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // Print document
  const handlePrint = () => {
    window.print();
  };

  // Download document as text
  const handleDownload = () => {
    const fullText = [
      title,
      lastUpdated,
      '==============================',
      ...sections.map((sec) => `\n${sec.title}\n${sec.rawText || ''}`),
    ].join('\n');

    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F6F4FC] text-[#1E1B2E] pb-28 pt-4 px-3 sm:px-6">
      <div className="max-w-[1120px] mx-auto">
        {/* Top Header / Back Navigation */}
        <div className="mb-4 flex items-center justify-between">
          <Button
            type="link"
            icon={<ArrowLeftOutlined className="text-sm" />}
            onClick={onBack}
            className="!px-0 text-[#6027D2] hover:text-[#4e1ba8] font-medium text-[13.5px] flex items-center"
          >
            Quay lại trang đăng ký
          </Button>
        </div>

        {/* Document Title Bar */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#ECE7FA] shadow-[0_4px_20px_rgba(96,39,210,0.04)] mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1E1B2E] tracking-tight">
              {title}
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-[#6E6A8A] mt-1.5 font-medium">
              <ClockCircleOutlined className="text-[#A098C2]" />
              <span>{lastUpdated}</span>
            </div>
          </div>

          {/* Actions: Search, Download, Print */}
          <div className="flex items-center gap-2.5">
            <Input
              prefix={<SearchOutlined className="text-[#A098C2] text-xs mr-1" />}
              placeholder="Tìm kiếm trong tài liệu..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              className="w-full sm:w-[240px] !h-[38px] text-[13px] rounded-xl"
            />
            <Tooltip title="Tải xuống tài liệu">
              <Button
                icon={<DownloadOutlined className="text-sm" />}
                onClick={handleDownload}
                className="!h-[38px] !w-[38px] rounded-xl border-[#ECE7FA] text-[#6E6A8A] hover:!text-[#6027D2] hover:!border-[#6027D2] flex items-center justify-center p-0"
              />
            </Tooltip>
            <Tooltip title="In tài liệu">
              <Button
                icon={<PrinterOutlined className="text-sm" />}
                onClick={handlePrint}
                className="!h-[38px] !w-[38px] rounded-xl border-[#ECE7FA] text-[#6E6A8A] hover:!text-[#6027D2] hover:!border-[#6027D2] flex items-center justify-center p-0"
              />
            </Tooltip>
          </div>
        </div>

        {/* 2-Column Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
          {/* Left Column: Mục lục (Sticky TOC) */}
          <aside className="hidden lg:block sticky top-6">
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#ECE7FA] shadow-sm max-h-[calc(100vh-180px)] overflow-y-auto">
              <h2 className="text-[14px] font-bold text-[#1E1B2E] mb-3 pb-2 border-b border-[#ECE7FA]">
                Mục lục
              </h2>
              <nav className="flex flex-col space-y-1">
                {sections.map((section) => {
                  const isActive = activeSectionId === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`text-left text-[12.5px] px-2.5 py-1.5 rounded-lg transition-all line-clamp-1 ${
                        isActive
                          ? 'font-semibold text-[#6027D2] bg-[#F6F4FC]'
                          : 'text-[#6E6A8A] hover:text-[#1E1B2E] hover:bg-[#F9F8FD]'
                      }`}
                    >
                      {section.title}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Right Column: Nội dung chi tiết */}
          <main className="bg-white rounded-2xl p-6 sm:p-8 border border-[#ECE7FA] shadow-sm">
            {intro && (
              <div className="mb-6 pb-6 border-b border-[#ECE7FA] text-[13.5px] text-[#4A4660] leading-relaxed">
                {intro}
              </div>
            )}

            {filteredSections.length === 0 ? (
              <div className="py-12 text-center text-[#6E6A8A] text-sm">
                Không tìm thấy nội dung phù hợp với từ khóa &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              <div className="space-y-8">
                {filteredSections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-24 pt-2 first:pt-0"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {section.icon && (
                        <span className="text-[17px] shrink-0">{section.icon}</span>
                      )}
                      <h2 className="text-[15.5px] font-bold text-[#1E1B2E] leading-snug">
                        {section.title}
                      </h2>
                    </div>
                    <div className="text-[13px] text-[#4A4660] leading-relaxed space-y-2">
                      {section.content}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Floating Bottom Bar (Sticky Footer) */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-[#ECE7FA] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-4 py-3.5">
        <div className="max-w-[1120px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <Checkbox
            checked={isChecked}
            onChange={(e) => handleCheckboxToggle(e.target.checked)}
            className="text-[12.5px] text-[#1E1B2E] font-medium select-none"
          >
            {checkboxLabel}
          </Checkbox>

          <Button
            type="primary"
            disabled={!isChecked}
            onClick={onAgree}
            className="w-full sm:w-auto !h-[40px] !px-7 text-[13.5px] font-medium rounded-full shrink-0 shadow-[0_4px_14px_rgba(96,39,210,0.25)]"
          >
            {buttonLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
