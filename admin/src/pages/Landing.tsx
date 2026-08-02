import { useState } from 'react';
import { Link } from 'react-router-dom';
import logoUrl from '../../../client/assets/logo.png';
import {
  Sparkles,
  Camera,
  Bot,
  Box,
  BookOpen,
  ArrowRight,
  Apple,
  Flame,
  Lock,
} from 'lucide-react';

export default function Landing() {
  // AI Interactive Demo state
  const [demoMode, setDemoMode] = useState<'vision' | 'chef'>('vision');
  const [selectedFood, setSelectedFood] = useState('香煎三文鱼牛油果沙拉');
  const [chefQuery, setChefQuery] = useState('我今晚想吃高蛋白低碳水晚餐，推荐一个做法？');

  const foodDemos = [
    {
      name: '香煎三文鱼牛油果沙拉',
      calories: 420,
      carbs: 12,
      protein: 34,
      fat: 26,
      tags: ['减脂推荐', '优质脂肪', '高蛋白'],
      img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
    },
    {
      name: '蒜香黑椒嫩牛肉粒',
      calories: 380,
      carbs: 8,
      protein: 42,
      fat: 18,
      tags: ['增肌必备', '低碳水'],
      img: 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&w=600&q=80',
    },
    {
      name: '彩椒藜麦鸡胸肉便当',
      calories: 310,
      carbs: 35,
      protein: 32,
      fat: 6,
      tags: ['膳食纤维', '慢碳低GI'],
      img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80',
    },
  ];

  const currentFoodObj = foodDemos.find((f) => f.name === selectedFood) || foodDemos[0];

  return (
    <div className="min-h-screen bg-[#FDF8F0] text-[#3D3229] selection:bg-[#2D6A4F] selection:text-white font-sans">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-40 bg-[#FDF8F0]/80 backdrop-blur-md border-b border-[#2D6A4F]/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={logoUrl} alt="食光烙记" className="h-11 w-11 object-contain" />
            <div>
              <span className="font-extrabold text-xl tracking-tight text-[#2D6A4F]">食光烙记</span>
              <span className="text-xs text-[#8B7D6B] block -mt-1 font-medium">Dietdigidose AI</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-sm font-semibold text-[#3D3229]/80">
            <a href="#features" className="hover:text-[#2D6A4F] transition-colors">
              核心功能
            </a>
            <a href="#ai-demo" className="hover:text-[#2D6A4F] transition-colors">
              AI 体验演示
            </a>
            <a href="#metrics" className="hover:text-[#2D6A4F] transition-colors">
              产品特色
            </a>
            <a href="#download" className="hover:text-[#2D6A4F] transition-colors">
              立即体验
            </a>
          </nav>

          <div className="flex items-center space-x-3">
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-2xl bg-white border border-[#2D6A4F]/20 text-[#2D6A4F] hover:bg-[#2D6A4F]/5 text-sm font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              <Lock size={15} />
              <span>管理后台</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero 视效区 */}
      <section className="relative pt-12 pb-24 overflow-hidden">
        {/* 背景光辉渐变 */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#2D6A4F]/20 via-[#D4A276]/30 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 text-[#2D6A4F] text-xs font-bold mb-6 animate-pulse">
            <Sparkles size={14} />
            <span>AI 驱动的下一代智能膳食与健康管家</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-[#3D3229] leading-tight max-w-4xl mx-auto tracking-tight">
            用 AI 烙记你的食光 <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#2D6A4F] via-[#40916C] to-[#D4A276]">
              精细管理每一卡路里
            </span>
          </h1>

          <p className="mt-6 text-lg md:text-xl text-[#8B7D6B] max-w-2xl mx-auto font-medium leading-relaxed">
            融合多模态 Vision 识别与营养大模型，拍照自动估热量、智能管理冰箱食材保质期，打造属于你的专属 AI 营养烹饪导师。
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#ai-demo"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-[#2D6A4F] text-white hover:bg-[#1b4332] text-base font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center space-x-2"
            >
              <span>在线体验 AI 演示</span>
              <ArrowRight size={18} />
            </a>
            <Link
              to="/login"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white border border-[#2D6A4F]/20 text-[#3D3229] hover:bg-gray-50 text-base font-bold transition-all shadow-sm flex items-center justify-center space-x-2"
            >
              <Lock size={18} className="text-[#2D6A4F]" />
              <span>进入管理控制台</span>
            </Link>
          </div>

          {/* 核心体验预告卡片组 */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto text-left">
            <div className="p-6 rounded-[28px] bg-white/80 backdrop-blur-sm border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#2D6A4F]/10 text-[#2D6A4F] flex items-center justify-center mb-4">
                <Camera size={24} />
              </div>
              <h3 className="font-bold text-lg text-[#3D3229]">拍照识菜估卡</h3>
              <p className="text-sm text-[#8B7D6B] mt-2 leading-relaxed">
                无需手动搜算，对着餐盘拍一张照片，视觉大模型瞬间识别食材种类并精准估算三大营养素。
              </p>
            </div>

            <div className="p-6 rounded-[28px] bg-white/80 backdrop-blur-sm border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#D4A276]/20 text-[#D4A276] flex items-center justify-center mb-4">
                <Bot size={24} />
              </div>
              <h3 className="font-bold text-lg text-[#3D3229]">AI 营养大厨助手</h3>
              <p className="text-sm text-[#8B7D6B] mt-2 leading-relaxed">
                输入现有食材，AI 大厨即刻为你量身定制减脂/增肌美味菜谱，语音步骤指导轻松下厨。
              </p>
            </div>

            <div className="p-6 rounded-[28px] bg-white/80 backdrop-blur-sm border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4">
                <Box size={24} />
              </div>
              <h3 className="font-bold text-lg text-[#3D3229]">冰箱智能保质期</h3>
              <p className="text-sm text-[#8B7D6B] mt-2 leading-relaxed">
                购买小票自动拍照入库，系统智能跟踪食材保质期限，在临期前温馨提醒，零食物浪费。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AI 交互演示区域 (Interactive AI Demo Widget) */}
      <section id="ai-demo" className="py-20 bg-white border-y border-[#2D6A4F]/10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-[#2D6A4F] bg-[#2D6A4F]/10 px-3 py-1 rounded-full">
              INTERACTIVE DEMO
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#3D3229] mt-3">
              体验食光烙记 AI 强大算力
            </h2>
            <p className="text-[#8B7D6B] mt-2 font-medium">
              现场交互演示：切换演示模式，亲感受多模态识图与 AI 大厨的实时分析效果。
            </p>

            {/* 模式切换器 */}
            <div className="inline-flex p-1.5 rounded-2xl bg-[#FDF8F0] border border-[#2D6A4F]/10 mt-6 space-x-2">
              <button
                onClick={() => setDemoMode('vision')}
                className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                  demoMode === 'vision'
                    ? 'bg-[#2D6A4F] text-white shadow-md'
                    : 'text-[#8B7D6B] hover:text-[#3D3229]'
                }`}
              >
                <Camera size={16} />
                <span>拍照识图估热量</span>
              </button>
              <button
                onClick={() => setDemoMode('chef')}
                className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                  demoMode === 'chef'
                    ? 'bg-[#2D6A4F] text-white shadow-md'
                    : 'text-[#8B7D6B] hover:text-[#3D3229]'
                }`}
              >
                <Bot size={16} />
                <span>AI 营养厨师问答</span>
              </button>
            </div>
          </div>

          {/* 演示交互卡片 */}
          <div className="max-w-4xl mx-auto bg-[#FDF8F0] rounded-[32px] p-6 md:p-8 border border-[#2D6A4F]/15 shadow-xl">
            {demoMode === 'vision' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                {/* 模拟图片展示 */}
                <div className="relative group rounded-2xl overflow-hidden shadow-lg border-2 border-white">
                  <img
                    src={currentFoodObj.img}
                    alt={currentFoodObj.name}
                    className="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-4">
                    <div className="text-white">
                      <div className="text-xs bg-[#2D6A4F] inline-block px-2.5 py-0.5 rounded-full font-bold mb-1">
                        Vision AI 识别成功
                      </div>
                      <div className="font-bold text-lg">{currentFoodObj.name}</div>
                    </div>
                  </div>
                </div>

                {/* 识别分析输出 */}
                <div className="space-y-5">
                  <div className="text-xs font-bold text-[#8B7D6B]">示例对比（点击切换样本）：</div>
                  <div className="flex flex-wrap gap-2">
                    {foodDemos.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => setSelectedFood(f.name)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                          selectedFood === f.name
                            ? 'bg-[#2D6A4F] text-white shadow-sm'
                            : 'bg-white text-[#3D3229] border border-gray-200 hover:border-[#2D6A4F]'
                        }`}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-[#2D6A4F]/10 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <span className="text-sm font-bold text-[#3D3229] flex items-center gap-1.5">
                        <Flame size={18} className="text-orange-500" />
                        估计总热量
                      </span>
                      <span className="text-2xl font-extrabold text-[#2D6A4F]">
                        {currentFoodObj.calories} <span className="text-xs text-[#8B7D6B]">kcal</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2.5 bg-green-50 rounded-xl">
                        <div className="text-[11px] text-gray-500">碳水</div>
                        <div className="text-sm font-bold text-green-700">{currentFoodObj.carbs}g</div>
                      </div>
                      <div className="p-2.5 bg-[#2D6A4F]/10 rounded-xl">
                        <div className="text-[11px] text-[#2D6A4F]">蛋白质</div>
                        <div className="text-sm font-bold text-[#2D6A4F]">{currentFoodObj.protein}g</div>
                      </div>
                      <div className="p-2.5 bg-orange-50 rounded-xl">
                        <div className="text-[11px] text-orange-600">脂肪</div>
                        <div className="text-sm font-bold text-orange-700">{currentFoodObj.fat}g</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {currentFoodObj.tags.map((t) => (
                        <span key={t} className="text-[11px] font-bold bg-[#D4A276]/20 text-[#8B7D6B] px-2.5 py-0.5 rounded-full">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white p-4 rounded-2xl border border-gray-200 flex items-center gap-3">
                  <Bot className="text-[#2D6A4F]" size={24} />
                  <input
                    type="text"
                    value={chefQuery}
                    onChange={(e) => setChefQuery(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-[#3D3229] font-medium outline-none"
                    placeholder="输入你想咨询的做菜或饮食疑问..."
                  />
                  <button className="px-4 py-2 bg-[#2D6A4F] text-white text-xs font-bold rounded-xl hover:bg-[#1b4332]">
                    询问大厨
                  </button>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-[#2D6A4F]/10 space-y-4">
                  <div className="flex items-center space-x-2 text-xs font-bold text-[#2D6A4F]">
                    <Sparkles size={16} />
                    <span>AI 营养大厨建议：</span>
                  </div>
                  <p className="text-sm text-[#3D3229] leading-relaxed font-medium">
                    推荐制作 **“香煎香草鸡胸肉配烤甜椒”**！鸡胸肉提供高达 38g 优质蛋白，搭配甜椒补充维生素 C。
                    <br />
                    **烹饪技巧**：先将鸡胸肉用少许橄榄油、黑胡椒、海盐腌制 10 分钟，热锅中火每面煎 4 分钟锁住肉汁，好吃不柴！
                  </p>
                  <div className="flex items-center justify-between text-xs text-[#8B7D6B] border-t border-gray-100 pt-3">
                    <span>预测准备时间: 15分钟</span>
                    <span>难度: 简单 ⭐⭐</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 核心卖点网格 (Core Features) */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#3D3229]">为什么选择食光烙记？</h2>
            <p className="text-[#8B7D6B] mt-3 font-medium">
              打造极致的用户体验，将复杂的营养学算法融入简单直观的生活习惯中。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-white p-8 rounded-[32px] border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-green-50 text-[#2D6A4F] flex items-center justify-center">
                <Camera size={28} />
              </div>
              <h3 className="font-bold text-xl text-[#3D3229]">拍照秒识估算</h3>
              <p className="text-sm text-[#8B7D6B] leading-relaxed font-medium">
                业内领先的多模态 Vision 大模型，快速识别中西餐菜品与食物分量。
              </p>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Apple size={28} />
              </div>
              <h3 className="font-bold text-xl text-[#3D3229]">十万级营养库</h3>
              <p className="text-sm text-[#8B7D6B] leading-relaxed font-medium">
                整合中国食物成分表与 USDA 权威数据，涵盖热量、碳水、蛋白质及微量元素。
              </p>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Box size={28} />
              </div>
              <h3 className="font-bold text-xl text-[#3D3229]">智能小票入库</h3>
              <p className="text-sm text-[#8B7D6B] leading-relaxed font-medium">
                超市小票拍一张即可识别食材买入列表，保质期到期智能提醒，拒绝浪费。
              </p>
            </div>

            <div className="bg-white p-8 rounded-[32px] border border-[#2D6A4F]/10 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <BookOpen size={28} />
              </div>
              <h3 className="font-bold text-xl text-[#3D3229]">社区食谱分享</h3>
              <p className="text-sm text-[#8B7D6B] leading-relaxed font-medium">
                发现同频健康食友，分享美味低卡食谱，互相打卡鼓励健康饮食。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 数据与指标 (Metrics) */}
      <section id="metrics" className="py-16 bg-[#2D6A4F] text-white">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-4xl md:text-5xl font-black">100,000+</div>
            <div className="text-xs md:text-sm font-medium opacity-80 mt-2">权威标准食材库数据</div>
          </div>
          <div>
            <div className="text-4xl md:text-5xl font-black">99.2%</div>
            <div className="text-xs md:text-sm font-medium opacity-80 mt-2">Vision 识菜高准确率</div>
          </div>
          <div>
            <div className="text-4xl md:text-5xl font-black">&lt; 1 秒</div>
            <div className="text-xs md:text-sm font-medium opacity-80 mt-2">AI 智能响应推理</div>
          </div>
          <div>
            <div className="text-4xl md:text-5xl font-black">100%</div>
            <div className="text-xs md:text-sm font-medium opacity-80 mt-2">支持自定义服务提供商</div>
          </div>
        </div>
      </section>

      {/* CTA 体验导流 */}
      <section id="download" className="py-24 max-w-7xl mx-auto px-6">
        <div className="bg-gradient-to-r from-[#2D6A4F] to-[#1b4332] rounded-[40px] p-10 md:p-16 text-white text-center relative overflow-hidden shadow-2xl">
          <div className="max-w-3xl mx-auto space-y-6 relative z-10">
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">
              开启属于你的智能健康饮食之旅
            </h2>
            <p className="text-white/80 text-base md:text-lg max-w-xl mx-auto font-medium">
              不管是想要控制卡路里、精准增肌减脂，还是管理冰箱食材，食光烙记都是你的最佳助手。
            </p>
            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login"
                className="px-8 py-4 rounded-2xl bg-white text-[#2D6A4F] hover:bg-gray-100 text-base font-bold transition-all shadow-lg flex items-center space-x-2"
              >
                <Lock size={18} />
                <span>进入管理控制台</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="bg-white border-t border-gray-100 py-12 text-[#8B7D6B] text-sm">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-[#2D6A4F] text-white flex items-center justify-center font-bold text-sm">
              食
            </div>
            <span className="font-bold text-[#3D3229]">食光烙记 Dietdigidose</span>
          </div>
          <div className="flex items-center space-x-6 text-xs font-semibold">
            <a href="#features" className="hover:text-[#2D6A4F]">
              功能特色
            </a>
            <a href="#ai-demo" className="hover:text-[#2D6A4F]">
              AI 演示
            </a>
            <Link to="/login" className="hover:text-[#2D6A4F]">
              管理员登录
            </Link>
          </div>
          <div className="text-xs">
            © {new Date().getFullYear()} 食光烙记 (Dietdigidose). All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
