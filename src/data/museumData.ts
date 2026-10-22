// 博物馆和文物数据

export interface Museum {
  id: string
  name: string
  nameEn: string
  location: string
  country: string
  established: string
  description: string
  coverImage: string
  /** 后台上传的真实封面 URL；为空时学生端回退到 coverImage（emoji） */
  coverUrl?: string
  artifacts: Artifact[]
}

export interface Artifact {
  id: string
  name: string
  nameEn: string
  museumId: string
  period: string
  civilization: string
  material: string
  dimensions: string
  description: string
  detailedDescription: string
  imageUrl: string
  significance: string
}

// 博物馆数据
export const museums: Museum[] = [
  {
    id: 'museum-1',
    name: '大英博物馆',
    nameEn: 'British Museum',
    location: '伦敦，英国',
    country: '英国',
    established: '1753年',
    description: '世界最著名的博物馆之一，收藏了来自世界各地的800多万件文物',
    coverImage: '🏛️',
    artifacts: [
      {
        id: 'artifact-1-1',
        name: '罗塞塔石碑',
        nameEn: 'Rosetta Stone',
        museumId: 'museum-1',
        period: '公元前196年',
        civilization: '古埃及',
        material: '花岗闪长岩',
        dimensions: '高112.3厘米，宽75.7厘米',
        description: '刻有三种文字的古埃及石碑，是解读古埃及象形文字的关键',
        detailedDescription:
          '罗塞塔石碑是1799年由法国士兵在埃及罗塞塔发现的。石碑上刻有古埃及象形文字、通俗体文字和古希腊文三种文字，内容相同。1822年，法国学者商博良通过对比三种文字，成功破译了古埃及象形文字，开启了古埃及学研究的新纪元。石碑原本是托勒密五世颁布的诏书，现已成为大英博物馆的镇馆之宝。',
        imageUrl: '/images/shipei.jpg',
        significance:
          '罗塞塔石碑是解读古埃及文明的关键文物，它的发现使人类重新认识了古埃及的历史和文化。',
      },
      {
        id: 'artifact-1-2',
        name: '帕特农神庙雕塑',
        nameEn: 'Parthenon Marbles',
        museumId: 'museum-1',
        period: '公元前447-432年',
        civilization: '古希腊',
        material: '大理石',
        dimensions: '不等',
        description: '来自雅典帕特农神庙的精美大理石雕塑',
        detailedDescription:
          '这些雕塑原本装饰在雅典卫城的帕特农神庙上，由著名雕塑家菲迪亚斯设计。1801-1812年间，英国贵族埃尔金勋爵将这些雕塑运到英国。雕塑展现了古希腊艺术的巅峰成就，包括精美的浮雕和独立雕像，描绘了神话故事和宗教仪式。这些雕塑至今仍是希腊和英国之间争议的焦点。',
        imageUrl: '/images/yiji.jpg',
        significance: '帕特农神庙雕塑代表了古希腊古典艺术的最高水平，是西方艺术史上的重要里程碑。',
      },
    ],
  },
  {
    id: 'museum-2',
    name: '卢浮宫',
    nameEn: 'Louvre Museum',
    location: '巴黎，法国',
    country: '法国',
    established: '1793年',
    description: '世界最大的艺术博物馆，收藏了超过38万件艺术品',
    coverImage: '🎨',
    artifacts: [
      {
        id: 'artifact-2-1',
        name: '蒙娜丽莎',
        nameEn: 'Mona Lisa',
        museumId: 'museum-2',
        period: '1503-1519年',
        civilization: '文艺复兴',
        material: '木板油画',
        dimensions: '77 × 53 厘米',
        description: '达芬奇创作的著名肖像画，世界上最著名的艺术作品之一',
        detailedDescription:
          '《蒙娜丽莎》是意大利文艺复兴时期艺术家列奥纳多·达·芬奇创作的肖像画，现藏于法国巴黎卢浮宫。画中人物神秘的微笑和深邃的眼神使其成为艺术史上最著名的作品之一。达芬奇运用了"晕涂法"（sfumato）技术，使画面呈现出柔和朦胧的效果。这幅画作每年吸引数百万游客前来参观，是卢浮宫最受欢迎的展品。',
        imageUrl: '/images/mengnalisha.jpg',
        significance:
          '《蒙娜丽莎》代表了文艺复兴时期肖像画的最高成就，其艺术价值和历史意义无可估量。',
      },
      {
        id: 'artifact-2-2',
        name: '维纳斯雕像',
        nameEn: 'Venus de Milo',
        museumId: 'museum-2',
        period: '公元前130-100年',
        civilization: '古希腊',
        material: '大理石',
        dimensions: '高202厘米',
        description: '古希腊时期的大理石雕像，展现爱与美的女神阿佛洛狄忒',
        detailedDescription:
          '维纳斯雕像（米洛的维纳斯）是古希腊时期创作的大理石雕像，1820年在希腊米洛斯岛被发现。雕像虽然失去了双臂，但其优美的体态和精湛的雕刻技艺使其成为古典艺术的杰作。雕像展现了古希腊艺术家对人体美的完美理解，体现了古典时期"高贵的单纯，静穆的伟大"的艺术理想。',
        imageUrl: 'https://images.unsplash.com/photo-1578301978163-9c8ae3e1e1e7?w=800',
        significance: '维纳斯雕像是古希腊雕塑艺术的代表作，对后世艺术发展产生了深远影响。',
      },
      {
        id: 'artifact-2-3',
        name: '汉谟拉比法典',
        nameEn: 'Code of Hammurabi',
        museumId: 'museum-2',
        period: '公元前1754年',
        civilization: '古巴比伦',
        material: '闪长岩',
        dimensions: '高225厘米',
        description: '世界上现存最早的成文法典，刻在黑色石柱上',
        detailedDescription:
          '汉谟拉比法典是古巴比伦国王汉谟拉比颁布的法律汇编，刻在一根黑色闪长岩石柱上。法典包含282条法律条文，涵盖了财产、婚姻、继承、犯罪等各个方面。法典顶部刻有汉谟拉比从太阳神沙马什手中接受法典的场景。这是人类历史上最早的成文法典之一，对后世法律发展产生了重要影响。',
        imageUrl: '/images/shibei.jpg',
        significance: '汉谟拉比法典是人类法律史上的重要里程碑，展现了古代文明的法律智慧。',
      },
    ],
  },
  {
    id: 'museum-3',
    name: '大都会艺术博物馆',
    nameEn: 'Metropolitan Museum of Art',
    location: '纽约，美国',
    country: '美国',
    established: '1870年',
    description: '美国最大的艺术博物馆，收藏了超过200万件艺术品',
    coverImage: '🏺',
    artifacts: [
      {
        id: 'artifact-3-1',
        name: '埃及法老图坦卡蒙的黄金面具',
        nameEn: "Tutankhamun's Golden Mask",
        museumId: 'museum-3',
        period: '公元前1323年',
        civilization: '古埃及',
        material: '黄金、宝石',
        dimensions: '高54厘米',
        description: '古埃及法老图坦卡蒙的葬礼面具，由纯金制成',
        detailedDescription:
          '图坦卡蒙的黄金面具是1922年霍华德·卡特在帝王谷发现的图坦卡蒙陵墓中的珍贵文物。面具由纯金打造，重达11公斤，镶嵌着青金石、红宝石等珍贵宝石。面具完美展现了年轻法老的容貌，体现了古埃及精湛的金属工艺和艺术水平。这是古埃及艺术最著名的作品之一。',
        imageUrl: 'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=800',
        significance: '图坦卡蒙黄金面具代表了古埃及艺术的巅峰，是研究古埃及文明的重要文物。',
      },
    ],
  },
  {
    id: 'museum-4',
    name: '故宫博物院',
    nameEn: 'Palace Museum',
    location: '北京，中国',
    country: '中国',
    established: '1925年',
    description: '中国最大的古代文化艺术博物馆，收藏了超过180万件文物',
    coverImage: '🏮',
    artifacts: [
      {
        id: 'artifact-4-1',
        name: '清明上河图',
        nameEn: 'Along the River During the Qingming Festival',
        museumId: 'museum-4',
        period: '北宋（1085-1145年）',
        civilization: '中华文明',
        material: '绢本设色',
        dimensions: '长528.7厘米，宽24.8厘米',
        description: '北宋画家张择端创作的著名风俗画，描绘了汴京的繁华景象',
        detailedDescription:
          '《清明上河图》是北宋画家张择端创作的绢本设色长卷，现藏于北京故宫博物院。画卷生动描绘了北宋都城汴京（今河南开封）的繁华景象，包括市井生活、商业活动、交通运输等各个方面。画中共有814个人物、28艘船只、60多只动物，展现了宋代社会的繁荣和城市生活的细节。这幅画作被誉为"中华第一神品"，是中国绘画史上的杰作。',
        imageUrl: '/images/qmsht.jpg',
        significance: '《清明上河图》是研究宋代社会历史的重要资料，也是中国绘画艺术的巅峰之作。',
      },
      {
        id: 'artifact-4-2',
        name: '后母戊鼎',
        nameEn: 'Houmuwu Ding',
        museumId: 'museum-4',
        period: '商朝晚期（约公元前1300年）',
        civilization: '中华文明',
        material: '青铜',
        dimensions: '高133厘米，重832.84公斤',
        description: '商朝最大的青铜鼎，中国古代青铜器的代表作',
        detailedDescription:
          '后母戊鼎（原名司母戊鼎）是商朝晚期铸造的青铜方鼎，1939年在河南安阳武官村出土。这是目前发现的最大的中国古代青铜器，重达832.84公斤。鼎身装饰有精美的饕餮纹、夔龙纹等纹饰，体现了商朝高超的青铜铸造技术。鼎内壁刻有"后母戊"三字，表明这是商王为祭祀母亲而铸造的礼器。',
        imageUrl: '/images/ting.jpg',
        significance: '后母戊鼎代表了商朝青铜铸造技术的最高水平，是中华文明的重要象征。',
      },
      {
        id: 'artifact-4-3',
        name: '《兰亭序》',
        nameEn: 'Preface to the Poems Composed at the Orchid Pavilion',
        museumId: 'museum-4',
        period: '东晋（353年）',
        civilization: '中华文明',
        material: '纸本',
        dimensions: '长24.5厘米，宽69.9厘米',
        description: '王羲之的书法杰作，被誉为"天下第一行书"',
        detailedDescription:
          '《兰亭序》是东晋书法家王羲之在永和九年（353年）为兰亭雅集所作的诗集序言。这篇书法作品被誉为"天下第一行书"，展现了王羲之高超的书法技艺。原作已失传，现存的都是摹本，其中最著名的是唐代冯承素的神龙本。作品用笔流畅自然，结体优美，章法疏朗，体现了中国书法的最高境界。',
        imageUrl: '/images/lantingji.jpg',
        significance: '《兰亭序》是中国书法艺术的巅峰之作，对后世书法发展产生了深远影响。',
      },
    ],
  },
  {
    id: 'museum-5',
    name: '埃尔米塔日博物馆',
    nameEn: 'State Hermitage Museum',
    location: '圣彼得堡，俄罗斯',
    country: '俄罗斯',
    established: '1764年',
    description: '俄罗斯最大的艺术博物馆，收藏了超过300万件艺术品',
    coverImage: '🕌',
    artifacts: [
      {
        id: 'artifact-5-1',
        name: '孔雀钟',
        nameEn: 'Peacock Clock',
        museumId: 'museum-5',
        period: '1770年代',
        civilization: '欧洲',
        material: '黄金、青铜、宝石',
        dimensions: '高约3米',
        description: '18世纪英国制造的自动机械钟，装饰精美',
        detailedDescription:
          '孔雀钟是18世纪英国著名机械师詹姆斯·考克斯制作的自动机械钟，现藏于俄罗斯埃尔米塔日博物馆。这座钟表装饰有黄金、青铜和宝石，当钟表运行时，孔雀会开屏，公鸡会啼叫，猫头鹰会转动头部。这是18世纪机械艺术的杰作，展现了当时欧洲精湛的工艺技术。',
        imageUrl: 'https://images.unsplash.com/photo-1578301978163-9c8ae3e1e1e7?w=800',
        significance: '孔雀钟代表了18世纪欧洲机械制造和装饰艺术的最高水平。',
      },
    ],
  },
  {
    id: 'museum-6',
    name: '埃及博物馆',
    nameEn: 'Egyptian Museum',
    location: '开罗，埃及',
    country: '埃及',
    established: '1902年',
    description: '世界上收藏古埃及文物最丰富的博物馆',
    coverImage: '🔺',
    artifacts: [
      {
        id: 'artifact-6-1',
        name: '图坦卡蒙的黄金棺',
        nameEn: "Tutankhamun's Golden Coffin",
        museumId: 'museum-6',
        period: '公元前1323年',
        civilization: '古埃及',
        material: '黄金、宝石',
        dimensions: '长187.5厘米',
        description: '图坦卡蒙法老的三层黄金棺椁中的最内层',
        detailedDescription:
          '图坦卡蒙的黄金棺是古埃及新王国时期为年轻法老图坦卡蒙制作的葬礼用品。棺椁由纯金打造，重达110.4公斤，表面装饰有精美的浮雕和象形文字。棺椁上刻有保护法老的咒语和图像，体现了古埃及人对来世的信仰。这是古埃及艺术和工艺的杰作。',
        imageUrl: 'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=800',
        significance: '图坦卡蒙黄金棺是古埃及葬礼艺术的巅峰之作，展现了古埃及文明的辉煌。',
      },
    ],
  },
  {
    id: 'museum-7',
    name: '普拉多博物馆',
    nameEn: 'Museo del Prado',
    location: '马德里，西班牙',
    country: '西班牙',
    established: '1819年',
    description: '西班牙最重要的艺术博物馆，收藏了大量欧洲绘画杰作',
    coverImage: '🖼️',
    artifacts: [
      {
        id: 'artifact-7-1',
        name: '宫娥',
        nameEn: 'Las Meninas',
        museumId: 'museum-7',
        period: '1656年',
        civilization: '欧洲',
        material: '布面油画',
        dimensions: '318 × 276 厘米',
        description: '委拉斯开兹的杰作，被誉为"绘画中的绘画"',
        detailedDescription:
          '《宫娥》是西班牙画家迭戈·委拉斯开兹在1656年创作的油画，现藏于马德里普拉多博物馆。这幅画作以其复杂的构图和创新的透视技巧而闻名。画面描绘了西班牙公主玛格丽特和她的侍女们，以及画家本人。作品巧妙地运用了镜子的反射，展现了国王和王后的形象，体现了委拉斯开兹高超的绘画技艺。',
        imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800',
        significance: '《宫娥》是西方绘画史上的重要作品，对后世艺术家产生了深远影响。',
      },
    ],
  },
  {
    id: 'museum-8',
    name: '乌菲齐美术馆',
    nameEn: 'Uffizi Gallery',
    location: '佛罗伦萨，意大利',
    country: '意大利',
    established: '1581年',
    description: '意大利最重要的艺术博物馆，收藏了文艺复兴时期的杰作',
    coverImage: '🎭',
    artifacts: [
      {
        id: 'artifact-8-1',
        name: '维纳斯的诞生',
        nameEn: 'The Birth of Venus',
        museumId: 'museum-8',
        period: '1485-1486年',
        civilization: '文艺复兴',
        material: '布面蛋彩画',
        dimensions: '172.5 × 278.5 厘米',
        description: '波提切利创作的著名画作，描绘了维纳斯从海中诞生的场景',
        detailedDescription:
          '《维纳斯的诞生》是意大利文艺复兴时期画家桑德罗·波提切利创作的蛋彩画，现藏于佛罗伦萨乌菲齐美术馆。画作描绘了罗马神话中爱与美的女神维纳斯从海中诞生的场景。作品展现了文艺复兴时期对古典美的追求，维纳斯的形象优雅而神秘，体现了人文主义精神。这是文艺复兴艺术的代表作之一。',
        imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800',
        significance: '《维纳斯的诞生》是文艺复兴艺术的经典之作，展现了人文主义的美学理想。',
      },
    ],
  },
]

// 获取所有文物
export const getAllArtifacts = (): Artifact[] => {
  return museums.flatMap((museum) => museum.artifacts)
}

// 根据博物馆ID获取文物
export const getArtifactsByMuseum = (museumId: string): Artifact[] => {
  const museum = museums.find((m) => m.id === museumId)
  return museum ? museum.artifacts : []
}

// 根据ID获取文物
export const getArtifactById = (id: string): Artifact | undefined => {
  return getAllArtifacts().find((artifact) => artifact.id === id)
}

// 根据ID获取博物馆
export const getMuseumById = (id: string): Museum | undefined => {
  return museums.find((museum) => museum.id === id)
}
