/**
 * 브랜드 용어집 (코드에서 분리)
 */

const glossary = {
  'eSIM': { official: 'eSIM', wrong: ['이심', 'e심', 'ESIM', 'esim', 'E-SIM'], desc: '디지털 SIM. 항상 "eSIM"으로 표기 (대소문자 주의)' },
  'USIM': { official: 'USIM', wrong: ['유심', '유심카드', 'usim'], desc: '물리적 SIM 카드. 공식 표기는 "USIM"이지만 사용자 문맥에서 "유심"도 허용' },
  '유심사': { official: '유심사', wrong: ['USIMSA', 'Usimgle', '유심사닷컴'], desc: '서비스 공식 명칭. 한글 "유심사"로 통일' },
  '요금제': { official: '요금제', wrong: ['플랜', '상품', '패키지'], desc: '데이터 상품을 지칭할 때 "요금제"로 통일' },
  '데이터': { official: '데이터', wrong: ['데이타', 'Data'], desc: '"데이터"로 통일. "데이타" 사용 금지' },
  '로밍': { official: '로밍', wrong: ['로밍서비스', '국제로밍'], desc: '해외 데이터 사용을 의미. "로밍"으로 간결하게' },
  'QR코드': { official: 'QR코드', wrong: ['QR 코드', 'qr코드', 'QR'], desc: '"QR코드" 붙여서 표기' },
  '활성화': { official: '활성화', wrong: ['개통', '등록', '액티베이션'], desc: 'eSIM/USIM을 사용 가능 상태로 만드는 것. "활성화"로 통일' },
  '충전': { official: '충전', wrong: ['리차지', '탑업', 'top-up'], desc: '데이터 추가 구매. "충전"으로 통일' },
  '고객센터': { official: '고객센터', wrong: ['CS', '상담센터', '콜센터', '지원센터'], desc: '고객 지원 채널. "고객센터"로 통일' },
  '로컬망': { official: '로컬망', wrong: ['현지망', '로컬 망', '현지 통신망'], desc: '현지 통신사에 직접 연결되는 네트워크. "로컬망"으로 통일' },
  '로밍망': { official: '로밍망', wrong: ['로밍 망', '제휴망'], desc: '제휴 통신사를 통해 연결되는 네트워크. "로밍망"으로 통일' },
  '핫스팟': { official: '핫스팟', wrong: ['테더링', 'tethering', 'hotspot'], desc: '다른 기기와 데이터를 공유하는 기능. "핫스팟"으로 통일하되, 괄호 안 "테더링" 병기 가능' },
  'APN': { official: 'APN', wrong: ['에이피엔', 'apn', '접속점'], desc: '네트워크 접속점 이름. 항상 대문자 "APN"으로 표기' },
  '유심사케어': { official: '유심사케어', wrong: ['유심사 케어', '케어 서비스', 'USIMSA Care'], desc: '통신 장애 보상 서비스. 붙여서 "유심사케어"로 표기' },
  '적립금': { official: '적립금', wrong: ['포인트', '리워드', 'reward'], desc: '결제 시 사용 가능한 금액. "적립금"으로 통일' },
};

module.exports = glossary;
