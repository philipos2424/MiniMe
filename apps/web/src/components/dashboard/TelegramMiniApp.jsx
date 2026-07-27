'use client';

import React, { useState } from 'react';
import {
  Home,
  MessageSquare,
  Sparkles,
  ShoppingBag,
  Settings,
  Plus,
  Share2,
  Pause,
  Play,
  Brain,
  ChevronRight,
  Star,
  Zap,
  CheckCircle2,
  TrendingUp,
  X,
  Search,
  Bot,
  User,
  ShieldCheck,
  Store,
  Globe,
  CreditCard,
  Camera,
  Download,
  Send,
  Kanban,
  FileSpreadsheet,
  Radio,
  Sliders,
  SlidersHorizontal,
  Edit2,
  Trash2,
  HelpCircle,
  Wand2,
  ArrowRight
} from 'lucide-react';

export default function TelegramMiniApp() {
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'chats' | 'advisor' | 'sales' | 'products'
  const [isBotLive, setIsBotLive] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);

  // FAB AI Assistance Menu State
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [fabPromptModal, setFabPromptModal] = useState(null); // title of prompt action

  // Products State
  const [products, setProducts] = useState([
    { id: '1', title: 'Samsung Galaxy A55 5G', price: 420, stock: 23, rating: 4.9, reviews: 32, emoji: '📱', category: 'Phones', description: 'Brand new 256GB, 8GB RAM with 1 year warranty.' },
    { id: '2', title: 'iPhone 15 Pro Max 256GB', price: 1350, stock: 12, rating: 4.9, reviews: 24, emoji: '📱', category: 'Phones', description: 'Natural Titanium edition.' },
    { id: '3', title: 'AirPods Pro 2nd Gen', price: 245, stock: 28, rating: 4.8, reviews: 19, emoji: '🎧', category: 'Audio', description: 'Active Noise Cancellation with USB-C case.' },
    { id: '4', title: 'MacBook Air M3 16GB', price: 1490, stock: 5, rating: 5.0, reviews: 11, emoji: '💻', category: 'Laptops', description: 'Midnight finish, M3 chip.' },
  ]);

  // Product Form State
  const [newProduct, setNewProduct] = useState({
    title: '',
    price: '',
    stock: '',
    category: 'Electronics',
    description: '',
    emoji: '📱'
  });

  // Channel Import Drawer/Modal State
  const [isChannelImportOpen, setIsChannelImportOpen] = useState(false);
  const [channelUsername, setChannelUsername] = useState('@AddisTechStore');
  const [isImporting, setIsImporting] = useState(false);

  // Teach AI Interactive Chips
  const [aiRules, setAiRules] = useState([
    { id: '1', label: 'We sell electronics' },
    { id: '2', label: 'Delivery available' },
    { id: '3', label: 'Telebirr & CBE accepted' },
    { id: '4', label: '1 Year Warranty included' },
    { id: '5', label: 'No returns after 7 days' },
  ]);
  const [newRuleInput, setNewRuleInput] = useState('');
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);

  // Sales Kanban Columns & Orders
  const [kanbanTab, setKanbanTab] = useState('NEW'); // 'NEW' | 'PROGRESS' | 'COMPLETED'
  const salesOrders = {
    NEW: [
      { id: 'ORD-101', customer: 'Abebe T.', item: 'Samsung Galaxy A55', amount: '$420', eta: '15 mins ago', status: 'Unconfirmed' },
      { id: 'ORD-102', customer: 'Selam K.', item: 'AirPods Pro 2', amount: '$245', eta: '32 mins ago', status: 'Pending Payment' },
      { id: 'ORD-103', customer: 'Dawit M.', item: 'MacBook Air M3', amount: '$1,490', eta: '1 hr ago', status: 'New Query' },
    ],
    PROGRESS: [
      { id: 'ORD-098', customer: 'Kidus G.', item: 'iPhone 15 Pro Max', amount: '$1,350', eta: 'Dispatching', status: 'In Courier' },
      { id: 'ORD-099', customer: 'Meron B.', item: 'Samsung Galaxy A55', amount: '$420', eta: 'Packing', status: 'Preparing' },
    ],
    COMPLETED: [
      { id: 'ORD-085', customer: 'Tadesse F.', item: 'Apple Watch Ultra 2', amount: '$850', eta: 'Delivered Today', status: 'Completed' },
      { id: 'ORD-086', customer: 'Hana W.', item: 'AirPods Pro 2', amount: '$245', eta: 'Delivered Today', status: 'Completed' },
    ]
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddProductSubmit = (e) => {
    e.preventDefault();
    if (!newProduct.title || !newProduct.price) return;
    const item = {
      id: Date.now().toString(),
      title: newProduct.title,
      price: Number(newProduct.price),
      stock: Number(newProduct.stock) || 1,
      category: newProduct.category || 'General',
      description: newProduct.description || 'Quality guaranteed product.',
      rating: 5.0,
      reviews: 1,
      emoji: newProduct.emoji || '📦'
    };
    setProducts([item, ...products]);
    setNewProduct({ title: '', price: '', stock: '', category: 'Electronics', description: '', emoji: '📱' });
    showToast(`✨ Added "${item.title}" to catalog!`);
  };

  const handleImportChannelProducts = () => {
    setIsImporting(true);
    setTimeout(() => {
      const importedItem = {
        id: Date.now().toString(),
        title: 'Sony WH-1000XM5 Headphones',
        price: 380,
        stock: 15,
        rating: 4.9,
        reviews: 8,
        emoji: '🎧',
        category: 'Audio',
        description: 'Auto-imported from Telegram post in ' + channelUsername
      };
      setProducts([importedItem, ...products]);
      setIsImporting(false);
      setIsChannelImportOpen(false);
      showToast(`🚀 Auto-imported 4 products from ${channelUsername}!`);
    }, 1500);
  };

  const removeRule = (id) => {
    setAiRules(aiRules.filter(r => r.id !== id));
    showToast('Rule removed');
  };

  const addRule = (e) => {
    e.preventDefault();
    if (!newRuleInput.trim()) return;
    setAiRules([...aiRules, { id: Date.now().toString(), label: newRuleInput.trim() }]);
    setNewRuleInput('');
    setIsAddRuleOpen(false);
    showToast('✨ AI Rule Added!');
  };

  const deleteProduct = (id) => {
    setProducts(products.filter(p => p.id !== id));
    showToast('Product deleted from inventory');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#07120E] via-[#0B1510] to-[#0E1712] text-white font-sans flex justify-center selection:bg-[#C9A86A] selection:text-[#07120E]">
      
      {/* Mobile Container max-480px */}
      <div className="w-full max-w-[480px] min-h-screen flex flex-col relative pb-28 border-x border-white/10 shadow-2xl backdrop-blur-md">
        
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#C9A86A] text-[#07120E] font-bold text-xs py-2.5 px-4 rounded-full shadow-2xl flex items-center gap-2 animate-fadeIn border border-white/20">
            <Sparkles size={16} />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Global Header */}
        <div className="p-6 pb-2 flex justify-between items-start">
          <div className="flex flex-col gap-0.5">
            <span className="text-[#A5B3AC] text-xs font-medium tracking-wide">Good Evening, Blen</span>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl font-bold tracking-tight text-white leading-tight">
                Addis Electronics
              </h1>
              <span className="bg-[#C9A86A]/15 text-[#C9A86A] border border-[#C9A86A]/30 font-semibold px-2 py-0.5 rounded-full text-[10px] tracking-wider uppercase">
                PRO PLAN
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsBotLive(!isBotLive)}
            className="backdrop-blur-md bg-white/5 border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-semibold hover:scale-[1.02] active:scale-[0.97] transition-all cursor-pointer shadow-sm"
          >
            <span className={`w-2 h-2 rounded-full ${isBotLive ? 'bg-[#59D18C] shadow-[0_0_8px_#59D18C] animate-pulse' : 'bg-[#FF7272]'}`} />
            <span className={isBotLive ? 'text-[#59D18C]' : 'text-[#FF7272]'}>
              {isBotLive ? '● Live' : 'Paused'}
            </span>
          </button>
        </div>

        {/* Search Bar (iOS Style Pill) */}
        <div className="px-6 pt-3 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A5B3AC]" />
            <input
              type="text"
              placeholder="Search products, orders, rules..."
              className="w-full bg-white/5 border border-white/10 backdrop-blur-md rounded-full py-2.5 pl-10 pr-4 text-xs text-white placeholder-[#A5B3AC]/60 outline-none focus:border-[#C9A86A]/50 focus:ring-1 focus:ring-[#C9A86A]/30 transition-all"
            />
          </div>
        </div>

        {/* Dynamic Screen Content */}
        <div className="flex-1 px-6 pt-4 flex flex-col">
          
          {/* ============================================================ */}
          {/* SCREEN A: HOME DASHBOARD                                     */}
          {/* ============================================================ */}
          {activeTab === 'home' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
              
              {/* Stacked Glass Metrics Cards */}
              <div className="flex flex-col gap-3">
                <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between hover:scale-[1.01] active:scale-[0.97] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#59D18C]/15 border border-[#59D18C]/30 flex items-center justify-center text-[#59D18C]">
                      <ShoppingBag size={20} />
                    </div>
                    <div>
                      <span className="text-[#A5B3AC] text-xs font-medium">Today's Orders</span>
                      <h3 className="text-xl font-bold text-white leading-tight">28 Orders</h3>
                    </div>
                  </div>
                  <span className="text-[#59D18C] text-xs font-semibold bg-[#59D18C]/10 px-2.5 py-1 rounded-full border border-[#59D18C]/20">
                    +18% today
                  </span>
                </div>

                <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between hover:scale-[1.01] active:scale-[0.97] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#C9A86A]/15 border border-[#C9A86A]/30 flex items-center justify-center text-[#C9A86A]">
                      <MessageSquare size={20} />
                    </div>
                    <div>
                      <span className="text-[#A5B3AC] text-xs font-medium">Messages</span>
                      <h3 className="text-xl font-bold text-white leading-tight">42 Chats</h3>
                    </div>
                  </div>
                  <span className="text-[#C9A86A] text-xs font-semibold bg-[#C9A86A]/10 px-2.5 py-1 rounded-full border border-[#C9A86A]/20">
                    94% Automated
                  </span>
                </div>

                <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between hover:scale-[1.01] active:scale-[0.97] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                      <Store size={20} />
                    </div>
                    <div>
                      <span className="text-[#A5B3AC] text-xs font-medium">Products</span>
                      <h3 className="text-xl font-bold text-white leading-tight">214 Items</h3>
                    </div>
                  </div>
                  <span className="text-blue-400 text-xs font-semibold bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
                    In Stock
                  </span>
                </div>

                <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between hover:scale-[1.01] active:scale-[0.97] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#59D18C]/15 border border-[#59D18C]/30 flex items-center justify-center text-[#59D18C]">
                      <Bot size={20} />
                    </div>
                    <div>
                      <span className="text-[#A5B3AC] text-xs font-medium">MiniMe Status</span>
                      <h3 className="text-xl font-bold text-[#59D18C] leading-tight flex items-center gap-2">
                        ● Running 24/7
                      </h3>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsBotLive(!isBotLive)}
                    className="text-xs text-[#A5B3AC] hover:text-white underline"
                  >
                    Toggle
                  </button>
                </div>
              </div>

              {/* Quick Actions Grid */}
              <div className="flex flex-col gap-3">
                <span className="text-[#A5B3AC] text-xs font-semibold uppercase tracking-wider">Quick Actions</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setActiveTab('products')}
                    className="backdrop-blur-md bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.97] transition-all text-center cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#C9A86A]/20 flex items-center justify-center text-[#C9A86A]">
                      <Plus size={20} />
                    </div>
                    <span className="text-xs font-semibold text-white">+ Add Product</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('advisor')}
                    className="backdrop-blur-md bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.97] transition-all text-center cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#59D18C]/20 flex items-center justify-center text-[#59D18C]">
                      <Brain size={20} />
                    </div>
                    <span className="text-xs font-semibold text-white">Teach AI</span>
                  </button>

                  <button
                    onClick={() => setIsChannelImportOpen(true)}
                    className="backdrop-blur-md bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.97] transition-all text-center cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-300">
                      <Download size={20} />
                    </div>
                    <span className="text-xs font-semibold text-white">Import Channel</span>
                  </button>

                  <button
                    onClick={() => showToast('📢 Broadcast feature ready for Telegram subscribers!')}
                    className="backdrop-blur-md bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.97] transition-all text-center cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-300">
                      <Radio size={20} />
                    </div>
                    <span className="text-xs font-semibold text-white">Broadcast</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ============================================================ */}
          {/* SCREEN B: CHAT SCREEN (INBOX)                                */}
          {/* ============================================================ */}
          {activeTab === 'chats' && (
            <div className="flex-1 flex flex-col justify-center items-center text-center animate-fadeIn py-12 px-4 my-auto">
              
              {/* Illustration Placeholder */}
              <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center text-[#C9A86A] shadow-xl shadow-[#C9A86A]/5 mb-6 animate-pulse">
                <MessageSquare size={48} />
              </div>

              <h2 className="font-serif text-xl font-bold text-white mb-2">Telegram Inbox Ready</h2>
              <p className="text-[#A5B3AC] text-xs max-w-[280px] leading-relaxed mb-8">
                💬 MiniMe is waiting. Customers who message your Telegram will appear here automatically.
              </p>

              <button
                onClick={() => showToast('Telegram Webhook Active & Listening ⚡')}
                className="w-full backdrop-blur-md bg-white/10 hover:bg-white/15 text-white font-bold py-3.5 px-6 rounded-2xl border border-white/15 hover:scale-[1.01] active:scale-[0.97] transition-all text-xs cursor-pointer"
              >
                Test Webhook Connection
              </button>

            </div>
          )}

          {/* ============================================================ */}
          {/* SCREEN C: SALES PAGE (MOBILE KANBAN BOARD)                   */}
          {/* ============================================================ */}
          {activeTab === 'sales' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
              
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-serif text-2xl font-bold text-white">Sales Pipeline</h2>
                  <p className="text-[#A5B3AC] text-xs">Kanban order tracking</p>
                </div>
                <span className="text-xs bg-[#C9A86A]/15 text-[#C9A86A] border border-[#C9A86A]/30 px-3 py-1 rounded-full font-semibold">
                  122 Orders
                </span>
              </div>

              {/* Mobile Kanban Tabs */}
              <div className="backdrop-blur-md bg-white/5 p-1 rounded-2xl border border-white/10 flex gap-1">
                {[
                  { id: 'NEW', label: 'NEW (12)' },
                  { id: 'PROGRESS', label: 'IN PROGRESS (8)' },
                  { id: 'COMPLETED', label: 'COMPLETED (102)' },
                ].map((col) => (
                  <button
                    key={col.id}
                    onClick={() => setKanbanTab(col.id)}
                    className={`flex-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                      kanbanTab === col.id
                        ? 'bg-white/15 text-[#C9A86A] border border-white/20 shadow-md'
                        : 'text-[#A5B3AC] hover:text-white'
                    }`}
                  >
                    {col.label}
                  </button>
                ))}
              </div>

              {/* Kanban Cards */}
              <div className="flex flex-col gap-3">
                {salesOrders[kanbanTab].map((order) => (
                  <div
                    key={order.id}
                    className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-2 hover:scale-[1.01] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-[#C9A86A]">{order.id}</span>
                      <span className="text-[10px] text-[#A5B3AC] bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                        {order.status}
                      </span>
                    </div>

                    <div className="flex justify-between items-baseline mt-1">
                      <h4 className="text-sm font-bold text-white">{order.customer} | {order.item}</h4>
                      <span className="text-sm font-extrabold text-[#59D18C]">{order.amount}</span>
                    </div>

                    <span className="text-[11px] text-[#A5B3AC]">ETA: {order.eta}</span>
                  </div>
                ))}
              </div>

            </div>
          )}

          {/* ============================================================ */}
          {/* SCREEN D: TEACH MINIME (ADVISOR)                              */}
          {/* ============================================================ */}
          {activeTab === 'advisor' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
              
              <div>
                <h2 className="font-serif text-2xl font-bold text-white">Teach MiniMe</h2>
                <p className="text-[#A5B3AC] text-xs">AI Knowledge & Rules engine</p>
              </div>

              {/* AI Knowledge Score */}
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-[#A5B3AC]">AI Knowledge Score</span>
                  <span className="text-lg font-bold text-[#59D18C]">84%</span>
                </div>

                {/* Animated Progress Bar */}
                <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="bg-gradient-to-r from-[#C9A86A] to-[#59D18C] h-full rounded-full transition-all duration-1000 shadow-[0_0_12px_#59D18C]"
                    style={{ width: '84%' }}
                  />
                </div>

                <span className="text-[11px] text-[#A5B3AC]">MiniMe is 84% confident answering store queries autonomously.</span>
              </div>

              {/* Interactive Rule Chips */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-[#A5B3AC] text-xs font-semibold uppercase tracking-wider">Active Rules</span>
                  <button
                    onClick={() => setIsAddRuleOpen(true)}
                    className="text-xs text-[#C9A86A] font-semibold hover:underline flex items-center gap-1"
                  >
                    <Plus size={14} /> Add Rule
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {aiRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="backdrop-blur-md bg-white/10 border border-white/15 px-3.5 py-2 rounded-full text-xs font-medium text-white flex items-center gap-2 hover:scale-[1.02] transition-all"
                    >
                      <span>{rule.label}</span>
                      <button
                        onClick={() => removeRule(rule.id)}
                        className="text-[#A5B3AC] hover:text-[#FF7272] cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Sample Action */}
              <button
                onClick={() => setIsAddRuleOpen(true)}
                className="w-full backdrop-blur-md bg-[#C9A86A]/15 text-[#C9A86A] border border-[#C9A86A]/30 font-bold py-3.5 rounded-2xl hover:scale-[1.01] active:scale-[0.97] transition-all text-xs flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <Plus size={16} /> + Add Sample Instruction
              </button>

            </div>
          )}

          {/* ============================================================ */}
          {/* SCREEN E: PRODUCT PAGE & TELEGRAM CHANNEL IMPORT             */}
          {/* ============================================================ */}
          {activeTab === 'products' && (
            <div className="flex flex-col gap-6 animate-fadeIn pb-6">
              
              <div>
                <h2 className="font-serif text-2xl font-bold text-white">Product Catalog</h2>
                <p className="text-[#A5B3AC] text-xs">Manage inventory & auto-import</p>
              </div>

              {/* Telegram Channel Import Feature Card */}
              <div className="backdrop-blur-md bg-gradient-to-r from-purple-900/30 via-purple-800/20 to-transparent border border-purple-500/30 rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                    <Download size={22} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Import Channel</h3>
                    <p className="text-[11px] text-[#A5B3AC] leading-snug">
                      Auto-sync existing product posts directly from your Telegram channel.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsChannelImportOpen(true)}
                  className="bg-purple-500 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl hover:scale-[1.02] active:scale-[0.97] transition-all shrink-0 cursor-pointer shadow-md"
                >
                  Import Now
                </button>
              </div>

              {/* Add Product Form Card */}
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
                <span className="text-xs font-bold text-[#C9A86A] uppercase tracking-wider flex items-center gap-1.5">
                  <Plus size={16} /> Add New Item
                </span>

                <form onSubmit={handleAddProductSubmit} className="flex flex-col gap-3.5">
                  {/* Photo Upload Placeholder */}
                  <div className="w-full h-24 rounded-xl border border-dashed border-white/20 bg-white/5 flex flex-col items-center justify-center text-[#A5B3AC] hover:border-[#C9A86A]/50 transition-all cursor-pointer">
                    <Camera size={24} className="mb-1 text-[#C9A86A]" />
                    <span className="text-xs font-medium">📷 Upload Photo</span>
                  </div>

                  <input
                    type="text"
                    required
                    placeholder="Product Name (e.g. Samsung A55)"
                    value={newProduct.title}
                    onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-[#A5B3AC]/50 outline-none focus:border-[#C9A86A]/50"
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      required
                      placeholder="Price ($ USD)"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                      className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-[#A5B3AC]/50 outline-none focus:border-[#C9A86A]/50"
                    />

                    <input
                      type="number"
                      placeholder="Stock Level (e.g. 23)"
                      value={newProduct.stock}
                      onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                      className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-[#A5B3AC]/50 outline-none focus:border-[#C9A86A]/50"
                    />
                  </div>

                  <input
                    type="text"
                    placeholder="Description"
                    value={newProduct.description}
                    onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-[#A5B3AC]/50 outline-none focus:border-[#C9A86A]/50"
                  />

                  {/* Large Premium Green Button */}
                  <button
                    type="submit"
                    className="w-full bg-[#59D18C] text-[#07120E] font-bold py-3.5 rounded-xl hover:scale-[1.01] active:scale-[0.97] transition-all text-xs cursor-pointer shadow-lg mt-1"
                  >
                    Add Product
                  </button>
                </form>
              </div>

              {/* Inventory List */}
              <div className="flex flex-col gap-3">
                <span className="text-[#A5B3AC] text-xs font-semibold uppercase tracking-wider">Store Inventory ({products.length})</span>
                {products.map((item) => (
                  <div
                    key={item.id}
                    className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3 hover:scale-[1.01] active:scale-[0.97] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-xl shrink-0 border border-white/10">
                        {item.emoji}
                      </div>
                      <div className="flex flex-col">
                        <h4 className="text-xs font-bold text-white leading-tight">{item.title}</h4>
                        <span className="text-[11px] text-[#A5B3AC] mt-0.5 font-medium">Stock: {item.stock} left</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-extrabold text-[#C9A86A]">${item.price}</span>
                      <button
                        onClick={() => deleteProduct(item.id)}
                        className="text-[#A5B3AC] hover:text-[#FF7272] transition-colors p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          )}

        </div>

        {/* ============================================================ */}
        {/* TELEGRAM CHANNEL IMPORT MODAL                                */}
        {/* ============================================================ */}
        {isChannelImportOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4">
            <div className="w-full max-w-[420px] bg-[#0E1712] rounded-3xl p-6 flex flex-col gap-5 border border-white/10 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Download size={20} className="text-purple-400" />
                  <h3 className="font-serif text-lg font-bold text-white">Import Telegram Channel</h3>
                </div>
                <button
                  onClick={() => setIsChannelImportOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/5 text-[#A5B3AC] hover:text-white flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-[#A5B3AC] leading-relaxed">
                Enter your public Telegram channel username. MiniMe will extract photos, titles, and prices automatically.
              </p>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[#A5B3AC]">Channel Username</label>
                <input
                  type="text"
                  value={channelUsername}
                  onChange={(e) => setChannelUsername(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl p-3.5 text-xs text-white outline-none focus:border-purple-400"
                />
              </div>

              <button
                onClick={handleImportChannelProducts}
                disabled={isImporting}
                className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-3.5 rounded-xl hover:scale-[1.01] active:scale-[0.97] transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {isImporting ? 'Parsing Channel Posts...' : 'Start Auto Import'}
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* ADD RULE MODAL                                               */}
        {/* ============================================================ */}
        {isAddRuleOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4">
            <div className="w-full max-w-[420px] bg-[#0E1712] rounded-3xl p-6 flex flex-col gap-5 border border-white/10 animate-fadeIn">
              <div className="flex justify-between items-center">
                <h3 className="font-serif text-lg font-bold text-white">Add Instruction Rule</h3>
                <button
                  onClick={() => setIsAddRuleOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/5 text-[#A5B3AC] hover:text-white flex items-center justify-center"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={addRule} className="flex flex-col gap-4">
                <input
                  type="text"
                  required
                  placeholder="e.g. Free shipping in Addis Ababa"
                  value={newRuleInput}
                  onChange={(e) => setNewRuleInput(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl p-3.5 text-xs text-white outline-none focus:border-[#C9A86A]"
                />

                <button
                  type="submit"
                  className="w-full bg-[#C9A86A] text-[#07120E] font-bold py-3.5 rounded-xl hover:scale-[1.01] active:scale-[0.97] transition-all text-xs cursor-pointer"
                >
                  Save Rule
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* FLOATING AI ACTION BUTTON (FAB) & POPOVER                     */}
        {/* ============================================================ */}
        <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2">
          {/* FAB Popover Menu */}
          {isFabOpen && (
            <div className="backdrop-blur-xl bg-[#0E1712]/95 border border-white/15 rounded-2xl p-2 flex flex-col gap-1 shadow-2xl animate-fadeIn w-48 mb-2">
              {[
                { label: 'Ask MiniMe', icon: HelpCircle },
                { label: 'Generate Reply', icon: Wand2 },
                { label: 'Improve Product', icon: Edit2 },
                { label: 'Write Promotion', icon: Send },
              ].map((act) => {
                const ActIcon = act.icon;
                return (
                  <button
                    key={act.label}
                    onClick={() => {
                      setIsFabOpen(false);
                      showToast(`✨ ${act.label} active!`);
                    }}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/10 text-xs font-semibold text-white transition-all text-left w-full cursor-pointer"
                  >
                    <ActIcon size={16} className="text-[#C9A86A]" />
                    <span>{act.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Main FAB Trigger */}
          <button
            onClick={() => setIsFabOpen(!isFabOpen)}
            className="bg-[#C9A86A] text-[#07120E] font-bold py-2.5 px-4 rounded-full shadow-2xl hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center gap-2 text-xs border border-white/20 cursor-pointer"
          >
            <Sparkles size={16} />
            <span>✨ Need help?</span>
          </button>
        </div>

        {/* ============================================================ */}
        {/* FIXED BOTTOM NAVIGATION BAR WITH TELEGRAM PREMIUM CIRCLE     */}
        {/* ============================================================ */}
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] backdrop-blur-xl bg-[#07120E]/90 px-2 py-3 border-t border-white/10 z-40 flex justify-around items-center">
          {[
            { id: 'home', label: 'Home', icon: Home },
            { id: 'chats', label: 'Chats', icon: MessageSquare },
            { id: 'advisor', label: 'Advisor', icon: Sparkles },
            { id: 'sales', label: 'Sales', icon: Kanban },
            { id: 'products', label: 'Settings', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-1 transition-all hover:scale-[1.05] active:scale-[0.95] cursor-pointer relative py-1 ${
                  isActive ? 'text-[#C9A86A]' : 'text-[#A5B3AC]'
                }`}
              >
                {/* Active Floating Blurred Glass Circle (Telegram Premium Style) */}
                {isActive && (
                  <div className="absolute inset-0 m-auto w-10 h-10 bg-white/15 backdrop-blur-md rounded-full border border-white/20 shadow-md shadow-[#C9A86A]/10 -z-10 animate-fadeIn" />
                )}
                <Icon size={20} className={isActive ? 'stroke-[2.5px]' : 'stroke-[1.8px]'} />
                <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

      </div>
    </div>
  );
}
